import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { BookPlus, CheckSquare, ClipboardCheck, Download, GraduationCap, Search, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { StudentGradeTrendPanel } from '../components/StudentGradeTrendPanel';
import { ErpDataset } from '../hooks/useErpData';
import { db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import {
  bulkTransitionCourseMarks,
  recordAuditLog,
  saveExamMarkWithAudit,
} from '../lib/erpService';
import { evaluateKenyanGrade } from '../lib/kenyaEngine';
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

  const [tab, setTab] = useState<'directory' | 'registration' | 'trends' | 'marks' | 'attendance'>(
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
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === 'registration'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Course Registration &amp; Transcripts
          </button>
          <button
            type="button"
            onClick={() => setTab('trends')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
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
            <button
              type="button"
              onClick={() =>
                exportToCSV(
                  'PUST_Student_Directory.csv',
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
                          {stu.programmeName || stu.programmeId} · Yr {stu.yearOfStudy} · {stu.category}
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Available Courses */}
              <div className="lg:col-span-6 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Available Semester Units
                  </h3>
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    {myStudent.admissionNo}
                  </span>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {data.courses.map((course) => {
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
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {course.creditUnits} Units · {course.schedule || 'TBA'} · {course.room || 'TBA'}
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
                  })}
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
    </div>
  );
}
