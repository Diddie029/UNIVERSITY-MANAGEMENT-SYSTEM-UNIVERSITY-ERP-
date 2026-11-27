import React, { useEffect, useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { CheckCircle2, GraduationCap, KeyRound, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, OperationType, sanitizeId } from '../lib/firebase';
import { recordAuditLog } from '../lib/erpService';
import { Student } from '../types/erp';

interface StudentActivationGateProps {
  student: Student;
  data: ErpDataset;
}

export function StudentActivationGate({ student, data }: StudentActivationGateProps) {
  const { firebaseUser, profile, signOut } = useAuth();
  const { showToast } = useToast();

  const [selectedDeptId, setSelectedDeptId] = useState(student.departmentId || '');
  const [selectedProgId, setSelectedProgId] = useState(student.programmeId || '');
  const [yearOfStudy, setYearOfStudy] = useState(String(student.yearOfStudy || 1));
  const [semester, setSemester] = useState(String(student.semester || 1));
  const [email, setEmail] = useState(student.email || firebaseUser?.email || '');
  const [phone, setPhone] = useState(student.phone || '');
  const [nationalIdConfirm, setNationalIdConfirm] = useState('');
  const [activating, setActivating] = useState(false);

  const deptProgrammes = useMemo(() => {
    if (!selectedDeptId) return data.programmes;
    const filtered = data.programmes.filter((p) => p.departmentId === selectedDeptId);
    return filtered.length > 0 ? filtered : data.programmes;
  }, [data.programmes, selectedDeptId]);

  useEffect(() => {
    if (deptProgrammes.length > 0 && !deptProgrammes.some((p) => p.id === selectedProgId)) {
      setSelectedProgId(deptProgrammes[0].id);
    }
  }, [deptProgrammes, selectedProgId]);

  const activeProg = data.programmes.find((p) => p.id === selectedProgId);
  const maxYears = activeProg?.durationYears || 6;

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;

    if (student.nationalId && nationalIdConfirm.trim().toUpperCase() !== student.nationalId.trim().toUpperCase()) {
      showToast('National ID / Birth Cert Number does not match your issued student record.', 'error');
      return;
    }

    const chosenProg = activeProg || data.programmes[0];
    if (!chosenProg) {
      showToast('Select your academic course first.', 'error');
      return;
    }

    const chosenDeptId = selectedDeptId || chosenProg.departmentId || '';
    const yr = Math.min(maxYears, Math.max(1, Number(yearOfStudy) || 1));
    const sem = Math.min(3, Math.max(1, Number(semester) || 1));
    const now = new Date().toISOString();

    setActivating(true);
    let currentOpPath = `students/${student.id}`;
    try {
      const studentPayload: Record<string, unknown> = {
        accountActivated: true,
        activatedAt: now,
        departmentId: chosenDeptId,
        programmeId: chosenProg.id,
        programmeName: clampStr(chosenProg.name, 180),
        yearOfStudy: yr,
        semester: sem,
        email: clampStr(email, 200),
        phone: clampStr(phone, 32),
        updatedAt: now,
      };
      if (!student.uid) {
        studentPayload.uid = firebaseUser.uid;
      }

      await updateDoc(doc(db, 'students', student.id), studentPayload);

      const bindingDocId = profile.bindingId || sanitizeId(student.admissionNo.toUpperCase());
      try {
        await updateDoc(doc(db, 'portal_bindings', bindingDocId), {
          activated: true,
          activatedAt: now,
        });
      } catch {
        // Safe if binding was already activated or aliased
      }

      currentOpPath = `users/${firebaseUser.uid}`;
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        accountActivated: true,
        departmentId: chosenDeptId,
        programmeId: chosenProg.id,
        lastActiveAt: now,
        updatedAt: now,
      });

      currentOpPath = 'audit_logs';
      await recordAuditLog(
        { uid: firebaseUser.uid, name: student.fullName, role: profile.role },
        'STUDENT_ACCOUNT_ACTIVATED',
        `students/${student.id}`,
        `Student ${student.admissionNo} activated newly issued account (${chosenProg.code}, Year ${yr}.${sem}).`
      );

      showToast(`Account ${student.admissionNo} activated! Welcome to EDUVANCE ERP.`, 'success');
    } catch (err) {
      if (currentOpPath === 'audit_logs' && err instanceof Error && err.message.startsWith('{"error":')) {
        throw err;
      }
      handleFirestoreError(err, OperationType.UPDATE, currentOpPath);
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-600/15 border border-amber-500/30 flex items-center justify-center">
              <GraduationCap className="w-5 h-5 text-amber-500" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 dark:text-white">
                Activate Your New EDUVANCE Student Account
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Your registration number <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{student.admissionNo}</span> has just been issued. Complete activation to enter the portal.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-red-500 text-slate-600 dark:text-slate-300"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out</span>
          </button>
        </div>

        <form onSubmit={handleActivate} className="p-6 space-y-5">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-start gap-3 text-xs text-slate-700 dark:text-slate-200">
            <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">
                Issued Account: {student.fullName} ({student.admissionNo})
              </p>
              <p>
                Confirm your identity and verify your Department, Course, and Current Year of Study before activating access to course registration, e-resources, and fee statements.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Verify National ID / Birth Cert Number
              </label>
              <input
                type="text"
                required
                value={nationalIdConfirm}
                onChange={(e) => setNationalIdConfirm(e.target.value)}
                placeholder="Enter issued National ID"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Student Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Department
              </label>
              <select
                value={selectedDeptId}
                onChange={(e) => setSelectedDeptId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Course / Programme
              </label>
              <select
                value={selectedProgId}
                onChange={(e) => setSelectedProgId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {deptProgrammes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name} ({p.durationYears} Yrs)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Current Year of Study
              </label>
              <select
                value={yearOfStudy}
                onChange={(e) => setYearOfStudy(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {Array.from({ length: maxYears }, (_, idx) => idx + 1).map((yr) => (
                  <option key={yr} value={String(yr)}>
                    Year {yr} of {maxYears}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Semester
                </label>
                <select
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="1">Semester 1</option>
                  <option value="2">Semester 2</option>
                  <option value="3">Semester 3</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+2547..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={activating}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
          >
            <KeyRound className="w-4 h-4" />
            <span>{activating ? 'Activating Account...' : 'Activate Account & Enter EDUVANCE ERP'}</span>
            <CheckCircle2 className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
