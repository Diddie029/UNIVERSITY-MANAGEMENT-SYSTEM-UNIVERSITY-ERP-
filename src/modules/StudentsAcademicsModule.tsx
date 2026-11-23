import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import {
  BookPlus,
  Building2,
  CalendarDays,
  CheckCircle2,
  CheckSquare,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  GraduationCap,
  KeyRound,
  Search,
  TrendingUp,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { BulkStudentImportModal } from '../components/BulkStudentImportModal';
import { ExamTimetablePanel } from '../components/ExamTimetablePanel';
import { StudentGradeTrendPanel } from '../components/StudentGradeTrendPanel';
import { ErpDataset } from '../hooks/useErpData';
import {
  clampStr,
  db,
  handleFirestoreError,
  hashVerificationKey,
  makeId,
  OperationType,
  sanitizeId,
} from '../lib/firebase';
import {
  bulkTransitionCourseMarks,
  recordAuditLog,
  saveExamMarkWithAudit,
} from '../lib/erpService';
import { evaluateKenyanGrade, generateAdmissionNumber } from '../lib/kenyaEngine';
import { exportToCSV, generateTranscriptPDF } from '../lib/pdfGenerator';
import { GradingRule, Student } from '../types/erp';

interface StudentsAcademicsModuleProps {
  mode: 'students' | 'academics';
  data: ErpDataset;
}

export function StudentsAcademicsModule({ mode, data }: StudentsAcademicsModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { showToast } = useToast();

  const isSuperAdmin = profile?.role === 'super_admin';
  const isStaff = ['super_admin', 'management', 'admissions', 'lecturer', 'hod', 'exam_officer'].includes(
    effectiveRole
  );
  const canEditStatus = ['super_admin', 'management', 'admissions'].includes(effectiveRole);
  const canModerate = ['super_admin', 'hod', 'exam_officer'].includes(effectiveRole);
  const canPublish = ['super_admin', 'exam_officer'].includes(effectiveRole);

  const [tab, setTab] = useState<'directory' | 'registration' | 'timetable' | 'trends' | 'marks' | 'attendance'>(
    mode === 'students' ? 'directory' : effectiveRole === 'student' ? 'registration' : 'marks'
  );

  useEffect(() => {
    if (effectiveRole === 'student') {
      setTab(mode === 'students' ? 'directory' : 'registration');
    } else {
      setTab(mode === 'students' ? 'directory' : 'marks');
    }
  }, [mode, effectiveRole]);

  const [search, setSearch] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [attendanceTopic, setAttendanceTopic] = useState('');
  const [presentIds, setPresentIds] = useState<string[]>([]);

  // Direct Student Registration State (Admin / Management / Admissions)
  const [showAddStudentForm, setShowAddStudentForm] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [newStuName, setNewStuName] = useState('');
  const [newStuAdmissionNo, setNewStuAdmissionNo] = useState('');
  const [newStuNationalId, setNewStuNationalId] = useState('');
  const [newStuEmail, setNewStuEmail] = useState('');
  const [newStuPhone, setNewStuPhone] = useState('');
  const [newStuDeptId, setNewStuDeptId] = useState('');
  const [newStuProgrammeId, setNewStuProgrammeId] = useState('');
  const [newStuCategory, setNewStuCategory] = useState<'KUCCPS' | 'Self-Sponsored'>('KUCCPS');
  const [newStuYear, setNewStuYear] = useState('1');
  const [newStuSemester, setNewStuSemester] = useState('1');
  const [newStuRequireActivation, setNewStuRequireActivation] = useState(true);
  const [creatingStudent, setCreatingStudent] = useState(false);

  // Student Registration Academic Path Selection (Department, Course, Year of Study)
  const [regDeptId, setRegDeptId] = useState('');
  const [regProgId, setRegProgId] = useState('');
  const [regYear, setRegYear] = useState('1');
  const [regSemester, setRegSemester] = useState('1');
  const [savingPath, setSavingPath] = useState(false);
  const [showAllCourseUnits, setShowAllCourseUnits] = useState(false);

  // Marks Draft Buffer per studentId
  const [draftMarks, setDraftMarks] = useState<Record<string, { cat: string; exam: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const activeCalendar = data.calendars.find((c) => c.isActive) ?? data.calendars[0];
  const academicYear = activeCalendar?.academicYear || '2026/2027';
  const semesterName = activeCalendar?.semesterName || 'Semester I (Sept - Dec)';

  const customGradingScale: GradingRule[] | undefined = useMemo(() => {
    const cfg = data.statutoryConfigs[0];
    if (!cfg?.gradingScaleJson) return undefined;
    try {
      return JSON.parse(cfg.gradingScaleJson) as GradingRule[];
    } catch {
      return undefined;
    }
  }, [data.statutoryConfigs]);

  const activeCourseId = selectedCourseId || data.courses[0]?.id || '';
  const activeCourse = data.courses.find((c) => c.id === activeCourseId);

  // Strict student record resolution: real students NEVER see another student's fallback record
  const myStudent: Student | undefined =
    effectiveRole === 'student'
      ? data.students.find((s) => s.id === profile?.studentId || s.uid === firebaseUser?.uid) ??
        (isSuperAdmin ? data.students[0] : undefined)
      : data.students.find((s) => s.id === selectedStudentId) ?? data.students[0];

  useEffect(() => {
    if (!myStudent) return;
    const prog = data.programmes.find((p) => p.id === myStudent.programmeId);
    setRegDeptId(myStudent.departmentId || prog?.departmentId || data.departments[0]?.id || '');
    setRegProgId(myStudent.programmeId || prog?.id || '');
    setRegYear(String(myStudent.yearOfStudy || 1));
    setRegSemester(String(myStudent.semester || 1));
  }, [myStudent?.id, myStudent?.departmentId, myStudent?.programmeId, myStudent?.yearOfStudy, myStudent?.semester, data.programmes, data.departments]);

  const filteredStudents = data.students.filter(
    (s) =>
      !search.trim() ||
      s.fullName.toLowerCase().includes(search.toLowerCase()) ||
      s.admissionNo.toLowerCase().includes(search.toLowerCase())
  );

  const enrolledInActiveCourse = useMemo(() => {
    const regs = data.registrations.filter(
      (r) => r.courseId === activeCourseId && r.status === 'registered'
    );
    return regs
      .map((r) => data.students.find((s) => s.id === r.studentId))
      .filter((s): s is Student => Boolean(s));
  }, [data.registrations, data.students, activeCourseId]);

  const marksForActiveCourse = data.examMarks.filter((m) => m.courseId === activeCourseId);

  const handleStatusChange = async (stu: Student, nextStatus: Student['academicStatus']) => {
    if (!firebaseUser || !profile) return;
    try {
      await updateDoc(doc(db, 'students', stu.id), {
        academicStatus: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENT_STATUS_UPDATED',
        `students/${stu.id}`,
        `Changed ${stu.admissionNo} status from ${stu.academicStatus} to ${nextStatus}.`
      );
      showToast(`${stu.admissionNo} status set to ${nextStatus}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${stu.id}`);
    }
  };

  const handleToggleClearance = async (
    stu: Student,
    field: 'clearanceDepartment' | 'clearanceExams' | 'clearanceLibrary'
  ) => {
    if (!firebaseUser || !profile) return;
    const nextVal = !Boolean(stu[field]);
    try {
      await updateDoc(doc(db, 'students', stu.id), {
        [field]: nextVal,
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENT_CLEARANCE_UPDATED',
        `students/${stu.id}`,
        `Set ${field}=${nextVal} for ${stu.admissionNo}.`
      );
      showToast(`Clearance updated for ${stu.admissionNo}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${stu.id}`);
    }
  };

  const handleCreateDirectStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const deptProgs = newStuDeptId
      ? data.programmes.filter((p) => p.departmentId === newStuDeptId)
      : data.programmes;
    const progId = newStuProgrammeId || deptProgs[0]?.id || data.programmes[0]?.id || '';
    const prog = data.programmes.find((p) => p.id === progId);
    if (!prog) {
      showToast('Select a valid academic programme.', 'error');
      return;
    }

    const cleanNationalId = clampStr(newStuNationalId, 32);
    if (cleanNationalId.length < 4) {
      showToast('Enter a National ID or Passport (min 4 chars) for student portal login verification.', 'error');
      return;
    }

    const admissionNo = (
      clampStr(newStuAdmissionNo, 64) ||
      generateAdmissionNumber(prog.code || 'GEN', data.students.length + 1)
    ).toUpperCase();

    const studentId = makeId('stu');
    const now = new Date().toISOString();
    const feeStruct = data.feeStructures.find(
      (f) => f.programmeId === prog.id && f.category === newStuCategory
    );
    const initialFee = Number(feeStruct?.totalFee ?? 0);
    const verificationHash = await hashVerificationKey(cleanNationalId);
    const dept = data.departments.find((d) => d.id === (newStuDeptId || prog.departmentId));

    setCreatingStudent(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'students', studentId), {
        admissionNo,
        fullName: clampStr(newStuName, 160),
        email: clampStr(newStuEmail, 200),
        phone: clampStr(newStuPhone, 32),
        nationalId: cleanNationalId,
        programmeId: prog.id,
        programmeName: prog.name,
        departmentId: dept?.id || prog.departmentId || '',
        facultyId: dept?.facultyId || '',
        yearOfStudy: Math.min(prog.durationYears || 7, Math.max(1, Number(newStuYear) || 1)),
        semester: Math.min(3, Math.max(1, Number(newStuSemester) || 1)),
        category: newStuCategory,
        academicStatus: 'Active',
        clearanceFinance: initialFee <= 0,
        clearanceLibrary: false,
        clearanceDepartment: false,
        clearanceExams: false,
        accountActivated: !newStuRequireActivation,
        createdAt: now,
        updatedAt: now,
      });

      batch.set(doc(db, 'student_accounts', studentId), {
        studentId,
        studentUid: '',
        admissionNo,
        studentName: clampStr(newStuName, 160),
        totalBilled: initialFee,
        totalPaid: 0,
        scholarshipsTotal: 0,
        balance: initialFee,
        cleared: initialFee <= 0,
        updatedAt: now,
      });

      batch.set(doc(db, 'portal_bindings', sanitizeId(admissionNo)), {
        code: admissionNo,
        targetType: 'student',
        targetId: studentId,
        role: 'student',
        fullName: clampStr(newStuName, 160),
        verificationHash,
        boundUid: '',
        activated: !newStuRequireActivation,
        createdAt: now,
      });

      await batch.commit();
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENT_DIRECTLY_ENROLLED',
        `students/${studentId}`,
        `Enrolled ${newStuName} (${admissionNo}) with Registration-Number login binding.`
      );
      showToast(`Enrolled ${admissionNo}. Student can now sign in via Registration No + National ID.`, 'success');
      setShowAddStudentForm(false);
      setNewStuName('');
      setNewStuAdmissionNo('');
      setNewStuNationalId('');
      setNewStuEmail('');
      setNewStuPhone('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `students/${studentId}`);
    } finally {
      setCreatingStudent(false);
    }
  };

  const handleResetStudentLoginBinding = async (stu: Student) => {
    if (!firebaseUser || !profile) return;
    const bindingId = sanitizeId(stu.admissionNo.toUpperCase());
    try {
      await updateDoc(doc(db, 'portal_bindings', bindingId), {
        boundUid: '',
      });
      await updateDoc(doc(db, 'students', stu.id), {
        uid: '',
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENT_LOGIN_BINDING_RESET',
        `portal_bindings/${bindingId}`,
        `Reset portal login binding for ${stu.admissionNo}.`
      );
      showToast(`Login binding reset for ${stu.admissionNo}. Student can re-bind on next sign-in.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `portal_bindings/${bindingId}`);
    }
  };

  const handleSaveStudentAcademicPath = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myStudent || !firebaseUser || !profile) return;
    const deptProgrammes = regDeptId
      ? data.programmes.filter((p) => p.departmentId === regDeptId)
      : data.programmes;
    const chosenProg =
      data.programmes.find((p) => p.id === regProgId) || deptProgrammes[0] || data.programmes[0];
    if (!chosenProg) {
      showToast('Select a valid course first.', 'error');
      return;
    }

    const chosenDeptId = regDeptId || chosenProg.departmentId || '';
    const yr = Math.min(chosenProg.durationYears || 7, Math.max(1, Number(regYear) || 1));
    const sem = Math.min(3, Math.max(1, Number(regSemester) || 1));
    const now = new Date().toISOString();

    setSavingPath(true);
    try {
      await updateDoc(doc(db, 'students', myStudent.id), {
        departmentId: chosenDeptId,
        programmeId: chosenProg.id,
        programmeName: clampStr(chosenProg.name, 180),
        yearOfStudy: yr,
        semester: sem,
        updatedAt: now,
      });
      if (effectiveRole === 'student' && !isSuperAdmin) {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          departmentId: chosenDeptId,
          programmeId: chosenProg.id,
          lastActiveAt: now,
          updatedAt: now,
        }).catch(() => {});
      }
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENT_ACADEMIC_PATH_UPDATED',
        `students/${myStudent.id}`,
        `Updated ${myStudent.admissionNo} registration path to ${chosenProg.code} · Year ${yr}.${sem}.`
      );
      showToast(`Saved Department, Course (${chosenProg.code}), and Year ${yr}.${sem}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${myStudent.id}`);
    } finally {
      setSavingPath(false);
    }
  };

  const handleRegisterUnit = async (courseId: string) => {
    if (!myStudent) return;
    const course = data.courses.find((c) => c.id === courseId);
    if (!course) return;
    const already = data.registrations.find(
      (r) => r.studentId === myStudent.id && r.courseId === courseId && r.status === 'registered'
    );
    if (already) {
      showToast(`${course.code} is already registered.`, 'info');
      return;
    }

    const regId = makeId('reg');
    try {
      await setDoc(doc(db, 'course_registrations', regId), {
        studentId: myStudent.id,
        studentUid: myStudent.uid || firebaseUser?.uid || '',
        admissionNo: myStudent.admissionNo,
        studentName: myStudent.fullName,
        academicYear,
        semesterName,
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        creditUnits: course.creditUnits,
        status: 'registered',
        createdAt: new Date().toISOString(),
      });
      showToast(`Registered ${course.code} — ${course.title}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `course_registrations/${regId}`);
    }
  };

  const handleSaveMark = async (student: Student) => {
    if (!activeCourse || !firebaseUser || !profile) return;
    const existing = marksForActiveCourse.find((m) => m.studentId === student.id);
    if (existing?.workflowStatus === 'published' && !canPublish) {
      showToast('Published marks are locked. Only Exam Officer or Super Admin can amend.', 'error');
      return;
    }

    const draft = draftMarks[student.id];
    const cat = Number(draft?.cat ?? existing?.catScore ?? 0);
    const exam = Number(draft?.exam ?? existing?.examScore ?? 0);
    if (cat < 0 || cat > 30 || exam < 0 || exam > 70) {
      showToast('CAT must be 0–30 and Exam must be 0–70.', 'error');
      return;
    }

    setSavingId(student.id);
    try {
      await saveExamMarkWithAudit(
        existing,
        {
          student,
          courseId: activeCourse.id,
          courseCode: activeCourse.code,
          courseTitle: activeCourse.title,
          creditUnits: activeCourse.creditUnits,
          academicYear,
          semesterName,
          catScore: cat,
          examScore: exam,
          workflowStatus: existing?.workflowStatus === 'published' ? 'published' : 'submitted',
        },
        customGradingScale,
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role }
      );
      showToast(`Saved ${activeCourse.code} marks for ${student.admissionNo}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save mark.', 'error');
    } finally {
      setSavingId(null);
    }
  };

  const handleBulkMarksTransition = async (target: 'moderated' | 'approved' | 'published') => {
    if (!activeCourse || !firebaseUser || !profile) return;
    const eligible = marksForActiveCourse.filter((m) => m.workflowStatus !== target);
    if (eligible.length === 0) {
      showToast(`All entered marks are already ${target}.`, 'info');
      return;
    }
    try {
      await bulkTransitionCourseMarks(
        eligible,
        target,
        activeCourse.code,
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role }
      );
      showToast(`Transitioned ${eligible.length} marks in ${activeCourse.code} to ${target}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Bulk transition failed.', 'error');
    }
  };

  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCourse || !firebaseUser) return;
    const sessionId = makeId('att');
    try {
      await setDoc(doc(db, 'attendance_sessions', sessionId), {
        courseId: activeCourse.id,
        courseCode: activeCourse.code,
        lecturerUid: firebaseUser.uid,
        sessionDate: new Date().toISOString().slice(0, 10),
        topic: attendanceTopic.trim() || 'Lecture Session',
        presentCount: presentIds.length,
        totalEnrolled: enrolledInActiveCourse.length,
        presentStudentIds: presentIds,
        createdAt: new Date().toISOString(),
      });
      showToast(
        `Attendance logged for ${activeCourse.code} (${presentIds.length}/${enrolledInActiveCourse.length}).`,
        'success'
      );
      setAttendanceTopic('');
      setPresentIds([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `attendance_sessions/${sessionId}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {effectiveRole === 'student'
              ? mode === 'students'
                ? 'My Student Profile & Clearance'
                : 'My Semester Units & Results'
              : mode === 'students'
              ? 'Student Information & Clearance'
              : 'Academics, Attendance & Examinations'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {academicYear} · {semesterName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {isStaff ? (
            <button
              type="button"
              onClick={() => setTab('directory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === 'directory'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              Student Records &amp; Clearance
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setTab('directory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === 'directory'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              My Profile &amp; Clearance
            </button>
          )}
          <button
            type="button"
            onClick={() => setTab('registration')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'registration'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Course Registration &amp; Transcripts
          </button>
          <button
            type="button"
            onClick={() => setTab('timetable')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'timetable'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            <span>Exam Timetable</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('trends')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'trends'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Grade Trend &amp; Focus</span>
          </button>
          {isStaff && (
            <>
              <button
                type="button"
                onClick={() => setTab('marks')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'marks'
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Marks &amp; Exam Workflow
              </button>
              <button
                type="button"
                onClick={() => setTab('attendance')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'attendance'
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Class Attendance
              </button>
            </>
          )}
        </div>
      </div>

      {/* STUDENT SELF PROFILE & CLEARANCE VIEW */}
      {tab === 'directory' && effectiveRole === 'student' && (
        <div className="space-y-6">
          {!myStudent ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No student profile linked yet. Sign in via the Student Registration No tab or await Admissions approval.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-600/15 border border-amber-500/30 flex items-center justify-center">
                    <GraduationCap className="w-5 h-5 text-amber-500" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{myStudent.fullName}</h3>
                    <p className="text-xs font-mono text-amber-600 dark:text-amber-400">{myStudent.admissionNo}</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Programme</dt>
                    <dd className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {myStudent.programmeName || myStudent.programmeId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Year &amp; Semester</dt>
                    <dd className="font-mono font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      Year {myStudent.yearOfStudy} · Sem {myStudent.semester}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Sponsorship Category</dt>
                    <dd className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                      {myStudent.category}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Academic Status</dt>
                    <dd className="font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {myStudent.academicStatus}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-4">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Departmental &amp; Graduation Clearance Status
                </h3>
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-sm">
                  {[
                    { label: 'Finance & Paybill Clearance', ok: Boolean(myStudent.clearanceFinance) },
                    { label: 'University Library Clearance', ok: Boolean(myStudent.clearanceLibrary) },
                    { label: 'Academic Department Clearance', ok: Boolean(myStudent.clearanceDepartment) },
                    { label: 'Examinations & Senate Clearance', ok: Boolean(myStudent.clearanceExams) },
                  ].map((item) => (
                    <div key={item.label} className="py-3 flex items-center justify-between">
                      <span className="text-slate-700 dark:text-slate-300">{item.label}</span>
                      <span
                        className={`text-xs font-semibold ${
                          item.ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {item.ok ? 'Cleared' : 'Pending'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 1: Staff Student Directory & Clearance */}
      {tab === 'directory' && isStaff && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search admission no or name..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {canEditStatus && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowBulkModal(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    <span>Bulk Upload Excel</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddStudentForm((v) => !v)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>{showAddStudentForm ? 'Close Form' : 'Register Student'}</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() =>
                  exportToCSV(
                    'EDUVANCE_Student_Directory.csv',
                    ['Admission No', 'Full Name', 'Programme', 'Year', 'Category', 'Status'],
                    filteredStudents.map((s) => [
                      s.admissionNo,
                      s.fullName,
                      s.programmeName || s.programmeId,
                      s.yearOfStudy,
                      s.category,
                      s.academicStatus,
                    ])
                  )
                }
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Student List CSV</span>
              </button>
            </div>
          </div>

          {canEditStatus && showAddStudentForm && (
            <form
              onSubmit={handleCreateDirectStudent}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Direct Student Enrollment &amp; Registration Number Provisioning
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Automatically creates a student portal login binding using Admission No + National ID.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddStudentForm(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newStuName}
                    onChange={(e) => setNewStuName(e.target.value)}
                    placeholder="e.g. Brian Kiprop Mutai"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Registration / Admission No (Blank = Auto)
                  </label>
                  <input
                    type="text"
                    value={newStuAdmissionNo}
                    onChange={(e) => setNewStuAdmissionNo(e.target.value)}
                    placeholder="e.g. EDU/CSC/2026/0099"
                    className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    National ID / Passport (Login Key)
                  </label>
                  <input
                    type="text"
                    required
                    value={newStuNationalId}
                    onChange={(e) => setNewStuNationalId(e.target.value)}
                    placeholder="e.g. 39481022"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Department
                  </label>
                  <select
                    value={newStuDeptId}
                    onChange={(e) => {
                      const dId = e.target.value;
                      setNewStuDeptId(dId);
                      const firstProg = data.programmes.find((p) => !dId || p.departmentId === dId);
                      if (firstProg) setNewStuProgrammeId(firstProg.id);
                    }}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    <option value="">All Departments</option>
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
                    value={newStuProgrammeId || data.programmes.find((p) => !newStuDeptId || p.departmentId === newStuDeptId)?.id || ''}
                    onChange={(e) => setNewStuProgrammeId(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    {data.programmes
                      .filter((p) => !newStuDeptId || p.departmentId === newStuDeptId)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.code} — {p.name} ({p.durationYears} Yrs)
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={newStuCategory}
                    onChange={(e) => setNewStuCategory(e.target.value as 'KUCCPS' | 'Self-Sponsored')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    <option value="KUCCPS">KUCCPS</option>
                    <option value="Self-Sponsored">Self-Sponsored</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Year
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={7}
                      value={newStuYear}
                      onChange={(e) => setNewStuYear(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Sem
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={newStuSemester}
                      onChange={(e) => setNewStuSemester(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Email (Optional)
                  </label>
                  <input
                    type="email"
                    value={newStuEmail}
                    onChange={(e) => setNewStuEmail(e.target.value)}
                    placeholder="student@students.eduvance.ac.ke"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={newStuPhone}
                    onChange={(e) => setNewStuPhone(e.target.value)}
                    placeholder="+2547..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newStuRequireActivation}
                    onChange={(e) => setNewStuRequireActivation(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  <span>Prompt student to activate newly issued account on first login</span>
                </label>
                <button
                  type="submit"
                  disabled={creatingStudent}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                >
                  {creatingStudent ? 'Provisioning...' : 'Enroll Student & Enable Login'}
                </button>
              </div>
            </form>
          )}

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Admission No</th>
                  <th className="py-3 px-4 font-medium">Student &amp; Programme</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium">Department / Exams Clearance</th>
                  <th className="py-3 px-4 font-medium text-right">Transcript</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredStudents.map((stu) => {
                  const stuMarks = data.examMarks.filter((m) => m.studentId === stu.id);
                  return (
                    <tr key={stu.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                        {stu.admissionNo}
                      </td>
                      <td className="py-3 px-4">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{stu.fullName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {stu.programmeName || stu.programmeId} · Yr {stu.yearOfStudy}.{stu.semester} · {stu.category}
                          {stu.accountActivated === false ? ' · Activation Pending' : ''}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        {canEditStatus ? (
                          <select
                            value={stu.academicStatus}
                            onChange={(e) =>
                              handleStatusChange(stu, e.target.value as Student['academicStatus'])
                            }
                            className="px-2 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                          >
                            {['Active', 'Academic Leave', 'Deferred', 'Graduated', 'Discontinued'].map((st) => (
                              <option key={st} value={st}>
                                {st}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs font-medium">{stu.academicStatus}</span>
                        )}
                      </td>
                      <td className="py-3 px-4 space-x-2 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => handleToggleClearance(stu, 'clearanceDepartment')}
                          className={`px-2 py-1 text-xs rounded border ${
                            stu.clearanceDepartment
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                              : 'border-slate-300 dark:border-slate-700 text-slate-500'
                          }`}
                        >
                          Dept: {stu.clearanceDepartment ? 'Cleared' : 'Pending'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleClearance(stu, 'clearanceExams')}
                          className={`px-2 py-1 text-xs rounded border ${
                            stu.clearanceExams
                              ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                              : 'border-slate-300 dark:border-slate-700 text-slate-500'
                          }`}
                        >
                          Exams: {stu.clearanceExams ? 'Cleared' : 'Pending'}
                        </button>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                        {canEditStatus && (
                          <button
                            type="button"
                            onClick={() => handleResetStudentLoginBinding(stu)}
                            title="Reset portal login binding for this Registration No"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                          >
                            <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                            <span>Reset Login</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedStudentId(stu.id);
                            setTab('trends');
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                        >
                          <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
                          <span>Grade Trend</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => generateTranscriptPDF(stu, stuMarks)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Transcript PDF</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Course Registration & Published Results */}
      {tab === 'registration' && (
        <div className="space-y-6">
          {isStaff && data.students.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Active Student Record:
              </label>
              <select
                value={myStudent?.id || ''}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {data.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.admissionNo} — {s.fullName}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!myStudent ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No student profile linked yet. Sign in via Student Registration No or wait for Admissions approval.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Student Department, Course & Year of Study Selector */}
              <form
                onSubmit={handleSaveStudentAcademicPath}
                className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-amber-500" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        Department, Course &amp; Current Year of Study Registration
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Select your academic department, degree/diploma course, and current year of study to match semester units.
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                    {myStudent.admissionNo}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Department
                    </label>
                    <select
                      value={regDeptId}
                      onChange={(e) => {
                        const dId = e.target.value;
                        setRegDeptId(dId);
                        const firstProg = data.programmes.find((p) => !dId || p.departmentId === dId);
                        if (firstProg) setRegProgId(firstProg.id);
                      }}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    >
                      {data.departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code} — {d.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="lg:col-span-2">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                      Course / Programme
                    </label>
                    <select
                      value={regProgId}
                      onChange={(e) => setRegProgId(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    >
                      {data.programmes
                        .filter((p) => !regDeptId || p.departmentId === regDeptId)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.code} — {p.name} ({p.durationYears} Years)
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Year of Study
                      </label>
                      <select
                        value={regYear}
                        onChange={(e) => setRegYear(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                      >
                        {Array.from(
                          {
                            length:
                              data.programmes.find((p) => p.id === regProgId)?.durationYears || 6,
                          },
                          (_, idx) => idx + 1
                        ).map((yr) => (
                          <option key={yr} value={String(yr)}>
                            Year {yr}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                        Semester
                      </label>
                      <select
                        value={regSemester}
                        onChange={(e) => setRegSemester(e.target.value)}
                        className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                      >
                        <option value="1">Sem 1</option>
                        <option value="2">Sem 2</option>
                        <option value="3">Sem 3</option>
                      </select>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingPath}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60 whitespace-nowrap"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{savingPath ? 'Saving...' : 'Save Academic Selection'}</span>
                  </button>
                </div>
              </form>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Available Courses */}
              <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                      Available Semester Units
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      {showAllCourseUnits
                        ? 'Showing all university units'
                        : `Filtered for ${myStudent.programmeName || myStudent.programmeId} · Yr ${myStudent.yearOfStudy}.${myStudent.semester}`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAllCourseUnits((v) => !v)}
                    className="px-2.5 py-1 text-xs font-medium rounded-md border border-slate-300 dark:border-slate-700 hover:border-amber-500"
                  >
                    {showAllCourseUnits ? `Filter Yr ${myStudent.yearOfStudy}.${myStudent.semester}` : 'Show All Units'}
                  </button>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {(() => {
                    const matched = data.courses.filter(
                      (c) =>
                        c.programmeId === myStudent.programmeId &&
                        c.yearLevel === myStudent.yearOfStudy &&
                        c.semesterNumber === myStudent.semester
                    );
                    const displayedCourses = showAllCourseUnits
                      ? data.courses
                      : matched.length > 0
                      ? matched
                      : data.courses.filter((c) => c.programmeId === myStudent.programmeId);

                    if (displayedCourses.length === 0) {
                      return (
                        <p className="p-6 text-xs text-slate-500 text-center">
                          No units found for this selection yet. Toggle &ldquo;Show All Units&rdquo; or ask your department admin to register units.
                        </p>
                      );
                    }

                    return displayedCourses.map((course) => {
                      const isReg = data.registrations.some(
                        (r) =>
                          r.studentId === myStudent.id &&
                          r.courseId === course.id &&
                          r.status === 'registered'
                      );
                      return (
                        <div key={course.id} className="p-4 flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                              <span className="font-mono text-amber-600 dark:text-amber-400 mr-2">
                                {course.code}
                              </span>
                              {course.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                              Yr {course.yearLevel}.{course.semesterNumber} · {course.creditUnits} Units · {course.schedule || 'TBA'} · {course.room || 'TBA'}
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={isReg}
                            onClick={() => handleRegisterUnit(course.id)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap ${
                              isReg
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 cursor-default'
                                : 'bg-amber-600 hover:bg-amber-500 text-white'
                            }`}
                          >
                            <BookPlus className="w-3.5 h-3.5" />
                            <span>{isReg ? 'Registered' : 'Register Unit'}</span>
                          </button>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>

              {/* Published Results & Transcript */}
              <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Published Examination Results
                  </h3>
                  <button
                    type="button"
                    onClick={() =>
                      generateTranscriptPDF(
                        myStudent,
                        data.examMarks.filter(
                          (m) =>
                            m.studentId === myStudent.id &&
                            (effectiveRole !== 'student' || m.workflowStatus === 'published')
                        )
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Transcript PDF</span>
                  </button>
                </div>
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="py-2.5 px-4 font-medium">Unit</th>
                      <th className="py-2.5 px-4 font-medium text-right">CAT</th>
                      <th className="py-2.5 px-4 font-medium text-right">Exam</th>
                      <th className="py-2.5 px-4 font-medium text-right">Total</th>
                      <th className="py-2.5 px-4 font-medium text-right">Grade</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {data.examMarks
                      .filter((m) => m.studentId === myStudent.id && m.workflowStatus === 'published')
                      .map((m) => (
                        <tr key={m.id}>
                          <td className="py-2.5 px-4">
                            <span className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                              {m.courseCode}
                            </span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">
                              {m.courseTitle}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.catScore}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums">{m.examScore}</td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                            {m.totalScore}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {m.grade}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
            </div>
          )}

          {myStudent && (
            <StudentGradeTrendPanel
              student={myStudent}
              students={data.students}
              onSelectStudent={setSelectedStudentId}
              isStaff={isStaff}
              effectiveRole={effectiveRole}
              courses={data.courses}
              registrations={data.registrations}
              examMarks={data.examMarks}
              assessmentSubmissions={data.assessmentSubmissions}
              assignmentSubmissions={data.assignmentSubmissions}
              onJumpToMarks={
                isStaff
                  ? (courseId) => {
                      setSelectedCourseId(courseId);
                      setTab('marks');
                    }
                  : undefined
              }
            />
          )}
        </div>
      )}

      {/* TAB: Interactive Examination Timetable */}
      {tab === 'timetable' && (
        <ExamTimetablePanel
          courses={data.courses}
          registrations={data.registrations}
          examTimetables={data.examTimetables}
          onlineAssessments={data.onlineAssessments}
          isStaff={isStaff}
          effectiveRole={effectiveRole}
          academicYear={academicYear}
          semesterName={semesterName}
          firebaseUser={firebaseUser}
          profile={profile}
          myStudent={myStudent}
        />
      )}

      {/* TAB: Grade Trend & Subject Focus Analysis */}
      {tab === 'trends' && (
        <StudentGradeTrendPanel
          student={myStudent}
          students={data.students}
          onSelectStudent={setSelectedStudentId}
          isStaff={isStaff}
          effectiveRole={effectiveRole}
          courses={data.courses}
          registrations={data.registrations}
          examMarks={data.examMarks}
          assessmentSubmissions={data.assessmentSubmissions}
          assignmentSubmissions={data.assignmentSubmissions}
          onJumpToMarks={
            isStaff
              ? (courseId) => {
                  setSelectedCourseId(courseId);
                  setTab('marks');
                }
              : undefined
          }
          onJumpToRegistration={() => setTab('registration')}
        />
      )}

      {/* TAB 3: Lecturer Marks Entry & Multi-Stage Exam Workflow */}
      {tab === 'marks' && isStaff && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Course Unit:</label>
              <select
                value={activeCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {data.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {canModerate && (
                <button
                  type="button"
                  onClick={() => handleBulkMarksTransition('moderated')}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-500/40 text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
                >
                  HoD: Moderate All
                </button>
              )}
              {canPublish && (
                <>
                  <button
                    type="button"
                    onClick={() => handleBulkMarksTransition('approved')}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg border border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
                  >
                    Exam Officer: Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBulkMarksTransition('published')}
                    className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    Publish Results to Students
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Admission No</th>
                  <th className="py-3 px-4 font-medium">Student Name</th>
                  <th className="py-3 px-4 font-medium">CAT (/30)</th>
                  <th className="py-3 px-4 font-medium">Exam (/70)</th>
                  <th className="py-3 px-4 font-medium text-right">Total &amp; Grade</th>
                  <th className="py-3 px-4 font-medium">Workflow State</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {enrolledInActiveCourse.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                      No students currently registered in {activeCourse?.code || 'this unit'}.
                    </td>
                  </tr>
                ) : (
                  enrolledInActiveCourse.map((stu) => {
                    const existing = marksForActiveCourse.find((m) => m.studentId === stu.id);
                    const draft = draftMarks[stu.id];
                    const catVal = draft?.cat ?? String(existing?.catScore ?? 0);
                    const examVal = draft?.exam ?? String(existing?.examScore ?? 0);
                    const preview = evaluateKenyanGrade(Number(catVal), Number(examVal), customGradingScale);
                    const locked = existing?.workflowStatus === 'published' && !canPublish;

                    return (
                      <tr key={stu.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                          {stu.admissionNo}
                        </td>
                        <td className="py-3 px-4 font-medium">{stu.fullName}</td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            min={0}
                            max={30}
                            disabled={locked}
                            value={catVal}
                            onChange={(e) =>
                              setDraftMarks((prev) => ({
                                ...prev,
                                [stu.id]: { cat: e.target.value, exam: examVal },
                              }))
                            }
                            className="w-20 px-2 py-1 text-sm font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 disabled:opacity-50"
                          />
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            min={0}
                            max={70}
                            disabled={locked}
                            value={examVal}
                            onChange={(e) =>
                              setDraftMarks((prev) => ({
                                ...prev,
                                [stu.id]: { cat: catVal, exam: e.target.value },
                              }))
                            }
                            className="w-20 px-2 py-1 text-sm font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 disabled:opacity-50"
                          />
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          <span className="font-semibold">{preview.totalScore}</span>
                          <span className="ml-2 text-amber-600 dark:text-amber-400 font-bold">
                            {preview.grade}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold capitalize">
                          <span
                            className={
                              existing?.workflowStatus === 'published'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }
                          >
                            {existing?.workflowStatus || 'Not Entered'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            disabled={locked || savingId === stu.id}
                            onClick={() => handleSaveMark(stu)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
                          >
                            {savingId === stu.id ? 'Saving...' : 'Save Marks'}
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: Class Attendance */}
      {tab === 'attendance' && isStaff && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSaveAttendance}
            className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
          >
            <div className="flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Record Lecture Attendance</h3>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Course Unit</label>
              <select
                value={activeCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {data.courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Lecture Topic</label>
              <input
                type="text"
                required
                value={attendanceTopic}
                onChange={(e) => setAttendanceTopic(e.target.value)}
                placeholder="e.g. Week 6: AVL Trees & Graph Traversal"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Mark Present Students ({presentIds.length}/{enrolledInActiveCourse.length})
              </p>
              {enrolledInActiveCourse.map((stu) => {
                const checked = presentIds.includes(stu.id);
                return (
                  <label
                    key={stu.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setPresentIds((prev) =>
                          checked ? prev.filter((id) => id !== stu.id) : [...prev, stu.id]
                        )
                      }
                      className="rounded border-slate-400 text-amber-600 focus:ring-amber-500"
                    />
                    <span className="font-mono text-xs text-amber-600 dark:text-amber-400">{stu.admissionNo}</span>
                    <span className="text-sm">{stu.fullName}</span>
                  </label>
                );
              })}
            </div>
            <button
              type="submit"
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              <CheckSquare className="w-4 h-4" />
              <span>Save Attendance Roll</span>
            </button>
          </form>

          <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Logged Attendance Sessions</h3>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {data.attendanceSessions.length === 0 ? (
                <p className="p-6 text-sm text-slate-500 dark:text-slate-400">No attendance sessions logged yet.</p>
              ) : (
                data.attendanceSessions.map((att) => (
                  <div key={att.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold">
                        <span className="font-mono text-amber-600 dark:text-amber-400 mr-2">{att.courseCode}</span>
                        {att.topic}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{att.sessionDate}</p>
                    </div>
                    <span className="font-mono text-xs font-semibold">
                      {att.presentCount} / {att.totalEnrolled}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <BulkStudentImportModal
        open={showBulkModal}
        data={data}
        onClose={() => setShowBulkModal(false)}
      />
    </div>
  );
}
