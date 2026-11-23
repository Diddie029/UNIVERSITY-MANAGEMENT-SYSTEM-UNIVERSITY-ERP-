import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ImageUp,
  KeyRound,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import { useToast } from './Toast';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { exportToCSV } from '../lib/pdfGenerator';
import {
  OnlineClass,
  OnlineClassAttendance,
  Student,
  UserProfile,
} from '../types/erp';

interface ClassAttendanceQrModalProps {
  open: boolean;
  onlineClass: OnlineClass | null;
  onlineClasses: OnlineClass[];
  isAcademicStaff: boolean;
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  myStudent?: Student;
  onClose: () => void;
}

interface QrPayload {
  type?: string;
  classId?: string;
  courseCode?: string;
  token?: string;
  expiresAt?: string;
}

function generateSessionToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `EDU-QR-${suffix}`;
}

function formatRemaining(expiresAt?: string): { text: string; expired: boolean } {
  if (!expiresAt) return { text: 'No expiry', expired: false };
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(diffMs)) return { text: 'Invalid expiry', expired: true };
  if (diffMs <= 0) return { text: 'Expired', expired: true };
  const totalSec = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return {
    text: `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`,
    expired: false,
  };
}

export function ClassAttendanceQrModal({
  open,
  onlineClass,
  onlineClasses,
  isAcademicStaff,
  firebaseUser,
  profile,
  myStudent,
  onClose,
}: ClassAttendanceQrModalProps) {
  const { showToast } = useToast();

  // Keep selected class synced with latest snapshot in onlineClasses
  const [fallbackClassId, setFallbackClassId] = useState<string>('');
  const activeClass: OnlineClass | undefined = useMemo(() => {
    if (onlineClass) {
      return onlineClasses.find((c) => c.id === onlineClass.id) ?? onlineClass;
    }
    if (fallbackClassId) {
      return onlineClasses.find((c) => c.id === fallbackClassId);
    }
    return onlineClasses.find((c) => c.status === 'live') ?? onlineClasses[0];
  }, [onlineClass, onlineClasses, fallbackClassId]);

  useEffect(() => {
    if (!open) return;
    if (!onlineClass && onlineClasses.length > 0 && !fallbackClassId) {
      const preferred = onlineClasses.find((c) => Boolean(c.qrToken) || c.status === 'live') ?? onlineClasses[0];
      setFallbackClassId(preferred.id);
    }
  }, [open, onlineClass, onlineClasses, fallbackClassId]);

  // Lecturer state
  const [validityMins, setValidityMins] = useState<number>(20);
  const [generatingQr, setGeneratingQr] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [attendees, setAttendees] = useState<OnlineClassAttendance[]>([]);
  const [, setTick] = useState(0);

  // Student scanner state
  const [scanTab, setScanTab] = useState<'camera' | 'upload' | 'code'>('camera');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false);
  const [confirmedCheckIn, setConfirmedCheckIn] = useState<{
    courseCode: string;
    classTitle: string;
    checkedInAt: string;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const processingScanRef = useRef(false);

  // Periodic countdown tick
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(timer);
  }, [open]);

  // Reset confirmation when modal opens/closes
  useEffect(() => {
    if (!open) {
      setConfirmedCheckIn(null);
      setManualInput('');
      setCameraError('');
    }
  }, [open]);

  // Subscribe to attendees for the active class
  useEffect(() => {
    if (!open || !activeClass || !firebaseUser) {
      setAttendees([]);
      return;
    }
    const q = query(
      collection(db, 'online_classes', activeClass.id, 'attendance'),
      orderBy('checkedInAt', 'desc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as OnlineClassAttendance);
        setAttendees(list);
      },
      () => {
        // Ignore transient permission errors during role transitions
      }
    );
    return () => unsub();
  }, [open, activeClass?.id, firebaseUser?.uid]);

  // Render QR Code whenever activeClass.qrToken updates
  useEffect(() => {
    if (!open || !activeClass?.qrToken) {
      setQrDataUrl('');
      return;
    }
    const payload: QrPayload = {
      type: 'eduvance_attendance',
      classId: activeClass.id,
      courseCode: activeClass.courseCode,
      token: activeClass.qrToken,
      expiresAt: activeClass.qrExpiresAt || '',
    };
    let cancelled = false;
    QRCode.toDataURL(JSON.stringify(payload), {
      width: 280,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeClass?.id, activeClass?.qrToken, activeClass?.qrExpiresAt]);

  const stopCamera = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  useEffect(() => {
    if (!open || isAcademicStaff || scanTab !== 'camera') {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, isAcademicStaff, scanTab, stopCamera]);

  const handleGenerateOrRotateQr = async () => {
    if (!activeClass) return;
    setGeneratingQr(true);
    const now = new Date();
    const expires = new Date(now.getTime() + validityMins * 60 * 1000);
    const token = generateSessionToken();
    try {
      await updateDoc(doc(db, 'online_classes', activeClass.id), {
        qrToken: token,
        qrCreatedAt: now.toISOString(),
        qrExpiresAt: expires.toISOString(),
        updatedAt: now.toISOString(),
      });
      showToast(`Attendance QR generated for ${activeClass.courseCode} (${validityMins} mins).`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `online_classes/${activeClass.id}`);
    } finally {
      setGeneratingQr(false);
    }
  };

  const processScannedText = useCallback(
    async (rawInput: string) => {
      if (!firebaseUser || !profile || processingScanRef.current) return;
      const trimmed = rawInput.trim();
      if (!trimmed) {
        showToast('Enter or scan a valid attendance QR code.', 'error');
        return;
      }

      let parsedClassId = '';
      let parsedToken = trimmed.toUpperCase();

      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed) as QrPayload;
          if (parsed.type && parsed.type !== 'eduvance_attendance') {
            showToast('This QR code is not an EDUVANCE class attendance code.', 'error');
            return;
          }
          parsedClassId = parsed.classId || '';
          parsedToken = (parsed.token || '').trim().toUpperCase();
        } catch {
          showToast('Unrecognized QR payload format.', 'error');
          return;
        }
      }

      if (!parsedToken) {
        showToast('Attendance token missing from QR payload.', 'error');
        return;
      }

      const targetClass =
        (parsedClassId ? onlineClasses.find((c) => c.id === parsedClassId) : undefined) ??
        onlineClasses.find((c) => (c.qrToken || '').toUpperCase() === parsedToken) ??
        activeClass;

      if (!targetClass) {
        showToast('No matching online class session found for that QR code.', 'error');
        return;
      }

      if (!targetClass.qrToken || targetClass.qrToken.toUpperCase() !== parsedToken) {
        showToast('Invalid or rotated attendance QR token. Please scan the lecturer’s current QR.', 'error');
        return;
      }

      if (targetClass.qrExpiresAt) {
        const expMs = new Date(targetClass.qrExpiresAt).getTime();
        if (!Number.isNaN(expMs) && Date.now() > expMs) {
          showToast('This attendance QR code has expired. Ask the lecturer to rotate a fresh QR.', 'error');
          return;
        }
      }

      processingScanRef.current = true;
      setSubmittingCheckIn(true);
      const nowIso = new Date().toISOString();
      const displayName = clampStr(
        myStudent ? myStudent.fullName : profile.displayName || 'Student',
        160
      );

      try {
        await setDoc(doc(db, 'online_classes', targetClass.id, 'attendance', firebaseUser.uid), {
          classId: targetClass.id,
          courseId: targetClass.courseId,
          courseCode: targetClass.courseCode,
          studentUid: firebaseUser.uid,
          studentId: myStudent?.id || '',
          admissionNo: myStudent?.admissionNo || '',
          displayName,
          tokenUsed: targetClass.qrToken,
          method: 'qr_scan',
          checkedInAt: nowIso,
        });

        await setDoc(doc(db, 'online_classes', targetClass.id, 'messages', makeId('msg')), {
          classId: targetClass.id,
          senderUid: firebaseUser.uid,
          senderName: clampStr(
            myStudent ? `${myStudent.fullName} (${myStudent.admissionNo})` : displayName,
            160
          ),
          senderRole: 'student',
          kind: 'checkin',
          body: `QR Attendance Verified (${myStudent?.admissionNo || displayName})`,
          createdAt: nowIso,
        });

        stopCamera();
        setConfirmedCheckIn({
          courseCode: targetClass.courseCode,
          classTitle: targetClass.title,
          checkedInAt: nowIso,
        });
        showToast(`Attendance recorded for ${targetClass.courseCode}!`, 'success');
      } catch (err) {
        handleFirestoreError(
          err,
          OperationType.CREATE,
          `online_classes/${targetClass.id}/attendance/${firebaseUser.uid}`
        );
      } finally {
        processingScanRef.current = false;
        setSubmittingCheckIn(false);
      }
    },
    [firebaseUser, profile, onlineClasses, activeClass, myStudent, showToast, stopCamera]
  );

  const startCamera = async () => {
    setCameraError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not supported in this browser context. Upload a QR image or enter the session code.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);

      const scanLoop = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !streamRef.current) return;

        if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'dontInvert',
            });
            if (code?.data) {
              void processScannedText(code.data);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(scanLoop);
      };

      rafRef.current = requestAnimationFrame(scanLoop);
    } catch {
      setCameraError('Camera permission denied or unavailable. Use "Upload QR Image" or "Enter Session Code" below.');
      stopCamera();
    }
  };

  const handleImageFileScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          showToast('Unable to decode image.', 'error');
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'attemptBoth',
        });
        if (!decoded?.data) {
          showToast('No readable QR code found in the uploaded image.', 'error');
          return;
        }
        void processScannedText(decoded.data);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        showToast('Could not read the selected image file.', 'error');
      };
      img.src = objectUrl;
    } catch {
      showToast('Failed to scan QR image.', 'error');
    }
  };

  const handleCopyToken = async () => {
    if (!activeClass?.qrToken) return;
    try {
      await navigator.clipboard.writeText(activeClass.qrToken);
      showToast(`Copied token ${activeClass.qrToken}`, 'info');
    } catch {
      showToast(`Session Token: ${activeClass.qrToken}`, 'info');
    }
  };

  if (!open) return null;

  const remaining = formatRemaining(activeClass?.qrExpiresAt);
  const myExistingAttendance = firebaseUser
    ? attendees.find((a) => a.studentUid === firebaseUser.uid)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-600/15 border border-amber-500/30 flex items-center justify-center">
              <QrCode className="w-4 h-4 text-amber-500" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAcademicStaff ? 'Session Attendance QR Generator & Roll' : 'Scan Class Attendance QR'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {activeClass ? `${activeClass.courseCode} · ${activeClass.title}` : 'Select an online class session'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Class Selector if opened globally */}
          {!onlineClass && onlineClasses.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Online Class Session
              </label>
              <select
                value={activeClass?.id || ''}
                onChange={(e) => setFallbackClassId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {onlineClasses.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.courseCode} — {cls.title} ({cls.status.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          )}

          {!activeClass ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 rounded-xl">
              No scheduled online classes available yet.
            </div>
          ) : isAcademicStaff ? (
            /* =============================================================== */
            /* LECTURER VIEW: QR GENERATOR + LIVE ATTENDANCE ROSTER            */
            /* =============================================================== */
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              <div className="md:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl p-4 bg-slate-50 dark:bg-slate-900/50 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    QR Validity Window
                  </label>
                  <select
                    value={validityMins}
                    onChange={(e) => setValidityMins(Number(e.target.value))}
                    className="px-2.5 py-1 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  >
                    <option value={10}>10 mins</option>
                    <option value={20}>20 mins</option>
                    <option value={45}>45 mins</option>
                    <option value={90}>90 mins</option>
                  </select>
                </div>

                <button
                  type="button"
                  disabled={generatingQr}
                  onClick={handleGenerateOrRotateQr}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${generatingQr ? 'animate-spin' : ''}`} />
                  <span>{activeClass.qrToken ? 'Rotate Session QR Code' : 'Generate Session QR Code'}</span>
                </button>

                {activeClass.qrToken && qrDataUrl ? (
                  <div className="space-y-3">
                    <div className="bg-white p-3 rounded-xl border border-slate-200 flex items-center justify-center">
                      <img
                        src={qrDataUrl}
                        alt={`Attendance QR for ${activeClass.courseCode}`}
                        className="w-52 h-52 object-contain"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs px-1">
                      <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                        {activeClass.qrToken}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 font-mono tabular-nums font-semibold ${
                          remaining.expired
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>{remaining.text}</span>
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleCopyToken}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-amber-500"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code</span>
                      </button>
                      <a
                        href={qrDataUrl}
                        download={`${activeClass.courseCode}_Attendance_QR.png`}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-amber-500"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Save PNG</span>
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="py-10 px-4 text-center border border-dashed border-slate-300 dark:border-slate-700 rounded-xl text-xs text-slate-500 dark:text-slate-400">
                    Click &ldquo;Generate Session QR Code&rdquo; to display a live attendance QR for students to scan.
                  </div>
                )}
              </div>

              {/* Live Attendance Roll */}
              <div className="md:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-white">
                    <Users className="w-4 h-4 text-amber-500" />
                    <span>
                      Verified Check-Ins (
                      <span className="font-mono tabular-nums">{attendees.length}</span>)
                    </span>
                  </div>
                  {attendees.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        exportToCSV(
                          `${activeClass.courseCode}_QR_Attendance.csv`,
                          ['Admission No', 'Student Name', 'Course', 'Method', 'Token', 'Checked In At'],
                          attendees.map((a) => [
                            a.admissionNo || 'N/A',
                            a.displayName,
                            a.courseCode,
                            a.method,
                            a.tokenUsed,
                            a.checkedInAt,
                          ])
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-amber-500"
                    >
                      <Download className="w-3 h-3" />
                      <span>Export CSV</span>
                    </button>
                  )}
                </div>

                <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-80 overflow-y-auto">
                  {attendees.length === 0 ? (
                    <p className="p-6 text-xs text-slate-500 dark:text-slate-400 text-center">
                      No students have scanned the QR code for this session yet.
                    </p>
                  ) : (
                    attendees.map((att) => (
                      <div key={att.id} className="px-4 py-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                            {att.displayName}
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            {att.admissionNo || 'Student'} · {att.method === 'qr_scan' ? 'QR Scan' : 'Manual'}
                          </p>
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                          {new Date(att.checkedInAt).toLocaleTimeString('en-KE', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* =============================================================== */
            /* STUDENT VIEW: CAMERA SCAN / QR IMAGE UPLOAD / SESSION TOKEN     */
            /* =============================================================== */
            <div className="space-y-4">
              {(confirmedCheckIn || myExistingAttendance) ? (
                <div className="border border-emerald-500/40 bg-emerald-500/10 rounded-xl p-6 text-center space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
                  <h4 className="text-base font-bold text-slate-900 dark:text-white">
                    Attendance Recorded
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {confirmedCheckIn?.courseCode || myExistingAttendance?.courseCode}
                    </span>
                    {' · '}
                    {confirmedCheckIn?.classTitle || activeClass.title}
                  </p>
                  <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    Checked in at{' '}
                    {new Date(
                      confirmedCheckIn?.checkedInAt || myExistingAttendance?.checkedInAt || Date.now()
                    ).toLocaleString('en-KE')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => setScanTab('camera')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${
                        scanTab === 'camera'
                          ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Camera Scanner</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setScanTab('upload')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${
                        scanTab === 'upload'
                          ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <ImageUp className="w-3.5 h-3.5" />
                      <span>Scan QR Image</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setScanTab('code')}
                      className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md ${
                        scanTab === 'code'
                          ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      <KeyRound className="w-3.5 h-3.5" />
                      <span>Enter Session Code</span>
                    </button>
                  </div>

                  {scanTab === 'camera' && (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 bg-slate-50 dark:bg-slate-900/50">
                      <div className="relative rounded-lg overflow-hidden bg-slate-950 aspect-video max-h-64 flex items-center justify-center">
                        <video
                          ref={videoRef}
                          muted
                          playsInline
                          className={`w-full h-full object-cover ${cameraActive ? 'block' : 'hidden'}`}
                        />
                        {!cameraActive && (
                          <div className="p-6 text-center space-y-3">
                            <QrCode className="w-10 h-10 text-amber-500 mx-auto opacity-80" />
                            <p className="text-xs text-slate-300">
                              Point your camera at the lecturer&apos;s session QR code to record attendance.
                            </p>
                            <button
                              type="button"
                              onClick={startCamera}
                              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                            >
                              <Camera className="w-3.5 h-3.5" />
                              <span>Enable Camera Scanner</span>
                            </button>
                          </div>
                        )}
                        <canvas ref={canvasRef} className="hidden" />
                      </div>
                      {cameraError && (
                        <p className="text-xs text-rose-500">{cameraError}</p>
                      )}
                      {cameraActive && (
                        <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span>Scanning video stream for EDUVANCE QR...</span>
                          <button
                            type="button"
                            onClick={stopCamera}
                            className="text-rose-500 hover:underline font-medium"
                          >
                            Stop Camera
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {scanTab === 'upload' && (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-6 text-center space-y-3 bg-slate-50 dark:bg-slate-900/50">
                      <ImageUp className="w-8 h-8 text-amber-500 mx-auto" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          Upload Screenshot or PNG of Class QR Code
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Select a PNG/JPG containing the lecturer&apos;s attendance QR code to verify immediately.
                        </p>
                      </div>
                      <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white cursor-pointer">
                        <ImageUp className="w-3.5 h-3.5" />
                        <span>Choose QR Image</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageFileScan}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}

                  {scanTab === 'code' && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void processScannedText(manualInput);
                      }}
                      className="border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3 bg-slate-50 dark:bg-slate-900/50"
                    >
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                        Enter Session Attendance Token or QR JSON Payload
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          required
                          value={manualInput}
                          onChange={(e) => setManualInput(e.target.value)}
                          placeholder="e.g. EDU-QR-7X9K2M"
                          className="flex-1 px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                        />
                        <button
                          type="submit"
                          disabled={submittingCheckIn}
                          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>{submittingCheckIn ? 'Verifying...' : 'Verify Attendance'}</span>
                        </button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
