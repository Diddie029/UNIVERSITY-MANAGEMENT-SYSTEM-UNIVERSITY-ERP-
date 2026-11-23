import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  CalendarDays,
  CalendarPlus,
  Clock,
  Download,
  Filter,
  MapPin,
  Plus,
  Search,
  UserCheck,
  X,
} from 'lucide-react';
import { User as FirebaseUser } from 'firebase/auth';
import { useToast } from './Toast';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { recordAuditLog } from '../lib/erpService';
import {
  Course,
  CourseRegistration,
  ExamTimetableEntry,
  OnlineAssessment,
  Student,
  UserProfile,
  UserRole,
} from '../types/erp';

interface ExamTimetablePanelProps {
  courses: Course[];
  registrations: CourseRegistration[];
  examTimetables: ExamTimetableEntry[];
  onlineAssessments: OnlineAssessment[];
  isStaff: boolean;
  effectiveRole: UserRole;
  academicYear: string;
  semesterName: string;
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  myStudent?: Student;
}

interface UnifiedExamItem {
  id: string;
  source: 'timetable' | 'online_assessment';
  courseId: string;
  courseCode: string;
  courseTitle: string;
  examType: ExamTimetableEntry['examType'];
  examDate: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  durationMinutes: number;
  venue: string;
  invigilator?: string;
  instructions?: string;
  status: 'scheduled' | 'postponed' | 'completed';
  academicYear: string;
  semesterName: string;
}

function escapeIcsText(val: string): string {
  return val
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function toIcsUtcDateTime(dateStr: string, timeStr: string, offsetMinutes = 0): string {
  // Parse local Kenya EAT (UTC+03:00) or browser local and format as YYYYMMDDTHHMMSS
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = (timeStr || '09:00').split(':').map(Number);
  const dt = new Date(y || 2026, (m || 1) - 1, d || 1, hh || 9, mm || 0, 0);
  dt.setMinutes(dt.getMinutes() + offsetMinutes);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}T${pad(dt.getHours())}${pad(
    dt.getMinutes()
  )}00`;
}

function buildIcsContent(items: UnifiedExamItem[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//EDUVANCE ERP//Exam Timetable//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:EDUVANCE Exam Timetable',
  ];

  for (const item of items) {
    const dtStart = toIcsUtcDateTime(item.examDate, item.startTime, 0);
    const dtEnd = toIcsUtcDateTime(item.examDate, item.startTime, item.durationMinutes);
    const summary = `${item.courseCode} ${item.examType} — ${item.courseTitle}`;
    const descParts = [
      `Course: ${item.courseCode} (${item.courseTitle})`,
      `Type: ${item.examType}`,
      `Status: ${item.status.toUpperCase()}`,
      item.invigilator ? `Invigilator: ${item.invigilator}` : '',
      item.instructions ? `Instructions: ${item.instructions}` : '',
    ].filter(Boolean);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:eduvance-exam-${item.id}@eduvance.ac.ke`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeIcsText(summary)}`);
    lines.push(`LOCATION:${escapeIcsText(item.venue)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(descParts.join('\n'))}`);
    lines.push(`STATUS:${item.status === 'postponed' ? 'TENTATIVE' : 'CONFIRMED'}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function downloadIcsFile(filename: string, items: UnifiedExamItem[]) {
  const content = buildIcsContent(items);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseMinutes(timeStr: string): number {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatTimeEnd(startTime: string, durationMinutes: number): string {
  const total = parseMinutes(startTime) + durationMinutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function ExamTimetablePanel({
  courses,
  registrations,
  examTimetables,
  onlineAssessments,
  isStaff,
  effectiveRole,
  academicYear,
  semesterName,
  firebaseUser,
  profile,
  myStudent,
}: ExamTimetablePanelProps) {
  const { showToast } = useToast();

  const [courseFilter, setCourseFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [timeframeFilter, setTimeframeFilter] = useState<'all' | 'upcoming'>('all');
  const [myUnitsOnly, setMyUnitsOnly] = useState<boolean>(effectiveRole === 'student');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'grouped'>('list');

  // Staff Scheduling Form State
  const [showAddForm, setShowAddForm] = useState(false);
  const [formCourseId, setFormCourseId] = useState('');
  const [formType, setFormType] = useState<ExamTimetableEntry['examType']>('End-of-Semester Exam');
  const [formDate, setFormDate] = useState('');
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formDuration, setFormDuration] = useState('120');
  const [formVenue, setFormVenue] = useState('');
  const [formInvigilator, setFormInvigilator] = useState('');
  const [formInstructions, setFormInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const myCourseIds = useMemo(() => {
    if (!myStudent) return new Set<string>();
    return new Set(
      registrations
        .filter((r) => r.studentId === myStudent.id && r.status === 'registered')
        .map((r) => r.courseId)
    );
  }, [registrations, myStudent]);

  // Merge physical exam_timetables + published onlineAssessments into a unified chronological timetable
  const allItems: UnifiedExamItem[] = useMemo(() => {
    const base: UnifiedExamItem[] = examTimetables.map((e) => ({
      id: e.id,
      source: 'timetable',
      courseId: e.courseId,
      courseCode: e.courseCode,
      courseTitle: e.courseTitle,
      examType: e.examType,
      examDate: e.examDate,
      startTime: e.startTime,
      durationMinutes: e.durationMinutes,
      venue: e.venue,
      invigilator: e.invigilator,
      instructions: e.instructions,
      status: e.status,
      academicYear: e.academicYear,
      semesterName: e.semesterName,
    }));

    const onlineItems: UnifiedExamItem[] = onlineAssessments
      .filter((a) => a.status !== 'draft' && a.dueDate)
      .map((a) => {
        const dt = new Date(a.dueDate);
        const dateStr = Number.isNaN(dt.getTime())
          ? a.dueDate.slice(0, 10)
          : dt.toISOString().slice(0, 10);
        const timeStr = Number.isNaN(dt.getTime())
          ? '09:00'
          : `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        return {
          id: `oa_${a.id}`,
          source: 'online_assessment',
          courseId: a.courseId,
          courseCode: a.courseCode,
          courseTitle: `${a.courseTitle} — ${a.title}`,
          examType: a.assessmentType === 'Online CAT' ? 'CAT' : 'Online Exam',
          examDate: dateStr,
          startTime: timeStr,
          durationMinutes: a.durationMinutes,
          venue: 'EDUVANCE Online Exam Portal',
          invigilator: a.createdByName,
          instructions: a.instructions,
          status: a.status === 'closed' ? 'completed' : 'scheduled',
          academicYear,
          semesterName,
        };
      });

    return [...base, ...onlineItems].sort((a, b) =>
      `${a.examDate} ${a.startTime}`.localeCompare(`${b.examDate} ${b.startTime}`)
    );
  }, [examTimetables, onlineAssessments, academicYear, semesterName]);

  const todayStr = new Date().toISOString().slice(0, 10);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allItems.filter((item) => {
      if (courseFilter !== 'all' && item.courseId !== courseFilter) return false;
      if (typeFilter !== 'all' && item.examType !== typeFilter) return false;
      if (timeframeFilter === 'upcoming' && item.examDate < todayStr) return false;
      if (myUnitsOnly && myStudent && myCourseIds.size > 0 && !myCourseIds.has(item.courseId)) {
        return false;
      }
      if (
        q &&
        !item.courseCode.toLowerCase().includes(q) &&
        !item.courseTitle.toLowerCase().includes(q) &&
        !item.venue.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [allItems, courseFilter, typeFilter, timeframeFilter, myUnitsOnly, myStudent, myCourseIds, searchQuery, todayStr]);

  // Detect time clashes within the filtered timetable
  const clashIds = useMemo(() => {
    const ids = new Set<string>();
    for (let i = 0; i < filteredItems.length; i += 1) {
      for (let j = i + 1; j < filteredItems.length; j += 1) {
        const a = filteredItems[i];
        const b = filteredItems[j];
        if (a.examDate !== b.examDate || a.status === 'postponed' || b.status === 'postponed') continue;
        const aStart = parseMinutes(a.startTime);
        const aEnd = aStart + a.durationMinutes;
        const bStart = parseMinutes(b.startTime);
        const bEnd = bStart + b.durationMinutes;
        if (aStart < bEnd && bStart < aEnd) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }, [filteredItems]);

  const groupedByDate = useMemo(() => {
    const map = new Map<string, UnifiedExamItem[]>();
    for (const item of filteredItems) {
      const existing = map.get(item.examDate) ?? [];
      existing.push(item);
      map.set(item.examDate, existing);
    }
    return Array.from(map.entries());
  }, [filteredItems]);

  const handleScheduleExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const targetCourseId = formCourseId || courses[0]?.id || '';
    const course = courses.find((c) => c.id === targetCourseId);
    if (!course) {
      showToast('Select a valid course unit.', 'error');
      return;
    }

    setSubmitting(true);
    const id = makeId('exm');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'exam_timetables', id), {
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        examType: formType,
        examDate: clampStr(formDate, 32),
        startTime: clampStr(formStartTime, 16),
        durationMinutes: Math.min(360, Math.max(15, Number(formDuration) || 120)),
        venue: clampStr(formVenue, 160),
        invigilator: clampStr(formInvigilator, 120),
        instructions: clampStr(formInstructions, 600),
        academicYear,
        semesterName,
        status: 'scheduled',
        createdByUid: firebaseUser.uid,
        createdByName: clampStr(profile.displayName || 'Exam Officer', 160),
        createdAt: now,
        updatedAt: now,
      });

      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'EXAM_TIMETABLE_PUBLISHED',
        `exam_timetables/${id}`,
        `Scheduled ${course.code} ${formType} on ${formDate} at ${formStartTime} in ${formVenue}.`
      );
      showToast(`Published ${course.code} exam slot to timetable.`, 'success');
      setShowAddForm(false);
      setFormVenue('');
      setFormInvigilator('');
      setFormInstructions('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `exam_timetables/${id}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusToggle = async (item: UnifiedExamItem, nextStatus: ExamTimetableEntry['status']) => {
    if (item.source !== 'timetable') return;
    try {
      await updateDoc(doc(db, 'exam_timetables', item.id), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast(`${item.courseCode} exam marked as ${nextStatus}.`, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `exam_timetables/${item.id}`);
    }
  };

  const handleExportAll = () => {
    if (filteredItems.length === 0) {
      showToast('No exam sessions match the current filters to export.', 'info');
      return;
    }
    downloadIcsFile('EDUVANCE_Exam_Timetable.ics', filteredItems);
    showToast(`Exported ${filteredItems.length} exam session(s) as .ics calendar file.`, 'success');
  };

  return (
    <div className="space-y-5">
      {/* Header + Primary Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-amber-500" />
            <span>Interactive Examination Timetable</span>
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {academicYear} · {semesterName} · Filter by unit or export directly to Google, Outlook, or Apple Calendar (.ics)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isStaff && (
            <button
              type="button"
              onClick={() => setShowAddForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-100"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddForm ? 'Close Form' : 'Schedule Exam'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportAll}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export Timetable (.ics)</span>
          </button>
        </div>
      </div>

      {/* Staff Exam Creation Form */}
      {isStaff && showAddForm && (
        <form
          onSubmit={handleScheduleExam}
          className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
              Schedule Examination Room &amp; Sitting
            </h4>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Course Unit
              </label>
              <select
                value={formCourseId || courses[0]?.id || ''}
                onChange={(e) => setFormCourseId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Exam Category
              </label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value as ExamTimetableEntry['examType'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                <option value="End-of-Semester Exam">End-of-Semester Exam</option>
                <option value="CAT">CAT</option>
                <option value="Practical Exam">Practical Exam</option>
                <option value="Online Exam">Online Exam</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Venue / Hall
              </label>
              <input
                type="text"
                required
                value={formVenue}
                onChange={(e) => setFormVenue(e.target.value)}
                placeholder="e.g. Old Main Hall · Wing A"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Exam Date
              </label>
              <input
                type="date"
                required
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Start Time
              </label>
              <input
                type="time"
                required
                value={formStartTime}
                onChange={(e) => setFormStartTime(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Duration (Mins)
              </label>
              <input
                type="number"
                min={15}
                max={360}
                required
                value={formDuration}
                onChange={(e) => setFormDuration(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Chief Invigilator
              </label>
              <input
                type="text"
                value={formInvigilator}
                onChange={(e) => setFormInvigilator(e.target.value)}
                placeholder="e.g. Dr. Amina Hassan"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Candidate Instructions (Optional)
            </label>
            <input
              type="text"
              value={formInstructions}
              onChange={(e) => setFormInstructions(e.target.value)}
              placeholder="e.g. Bring valid Student ID card and non-programmable scientific calculator."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
            >
              {submitting ? 'Publishing...' : 'Publish Exam Slot'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
          <div className="md:col-span-4 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search course code, title, or hall..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
            />
          </div>

          <div className="md:col-span-3">
            <select
              value={courseFilter}
              onChange={(e) => setCourseFilter(e.target.value)}
              aria-label="Filter by course"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
            >
              <option value="all">All Course Units</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="Filter by exam type"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900"
            >
              <option value="all">All Exam Types</option>
              <option value="End-of-Semester Exam">End-of-Semester Exam</option>
              <option value="Practical Exam">Practical Exam</option>
              <option value="CAT">CAT</option>
              <option value="Online Exam">Online Exam</option>
            </select>
          </div>

          <div className="md:col-span-2 flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`flex-1 py-1 text-xs font-medium rounded ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grouped')}
              className={`flex-1 py-1 text-xs font-medium rounded ${
                viewMode === 'grouped'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500'
              }`}
            >
              By Day
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={timeframeFilter === 'upcoming'}
                onChange={(e) => setTimeframeFilter(e.target.checked ? 'upcoming' : 'all')}
                className="rounded border-slate-400 text-amber-600 focus:ring-amber-500"
              />
              <span>Upcoming dates only</span>
            </label>

            {myStudent && myCourseIds.size > 0 && (
              <label className="inline-flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={myUnitsOnly}
                  onChange={(e) => setMyUnitsOnly(e.target.checked)}
                  className="rounded border-slate-400 text-amber-600 focus:ring-amber-500"
                />
                <span>My registered units only ({myCourseIds.size})</span>
              </label>
            )}
          </div>

          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <Filter className="w-3.5 h-3.5" />
              <span>{filteredItems.length} session(s)</span>
            </span>
            {clashIds.size > 0 && (
              <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Time clash detected</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Timetable Display */}
      {filteredItems.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          No exam sittings match your selected filters. Adjust course or timeframe filters to view full schedule.
        </div>
      ) : viewMode === 'list' ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y divide-slate-200 dark:divide-slate-800 overflow-hidden">
          {filteredItems.map((item) => {
            const hasClash = clashIds.has(item.id);
            const endTime = formatTimeEnd(item.startTime, item.durationMinutes);
            return (
              <div
                key={item.id}
                className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-slate-800/30"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                      {item.courseCode}
                    </span>
                    <span className="text-slate-400" aria-hidden="true">·</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">{item.examType}</span>
                    <span className="text-slate-400" aria-hidden="true">·</span>
                    <span
                      className={`font-semibold uppercase ${
                        item.status === 'postponed'
                          ? 'text-rose-600 dark:text-rose-400'
                          : item.status === 'completed'
                          ? 'text-slate-500 dark:text-slate-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {item.status}
                    </span>
                    {hasClash && (
                      <>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="font-semibold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Overlapping Sitting</span>
                        </span>
                      </>
                    )}
                  </div>

                  <h4 className="text-sm font-bold text-slate-900 dark:text-white">{item.courseTitle}</h4>

                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="w-3.5 h-3.5 text-amber-500" />
                      <span>
                        {new Date(`${item.examDate}T00:00:00`).toLocaleDateString('en-KE', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-amber-500" />
                      <span>
                        {item.startTime} – {endTime} ({item.durationMinutes} mins)
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 font-sans">
                      <MapPin className="w-3.5 h-3.5 text-amber-500" />
                      <span>{item.venue}</span>
                    </span>
                    {item.invigilator && (
                      <span className="inline-flex items-center gap-1 font-sans">
                        <UserCheck className="w-3.5 h-3.5 text-amber-500" />
                        <span>{item.invigilator}</span>
                      </span>
                    )}
                  </div>

                  {item.instructions && (
                    <p className="text-xs text-slate-600 dark:text-slate-300">{item.instructions}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {isStaff && item.source === 'timetable' && (
                    <select
                      value={item.status}
                      onChange={(e) =>
                        handleStatusToggle(item, e.target.value as ExamTimetableEntry['status'])
                      }
                      aria-label={`Status for ${item.courseCode}`}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                    >
                      <option value="scheduled">Scheduled</option>
                      <option value="postponed">Postponed</option>
                      <option value="completed">Completed</option>
                    </select>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      downloadIcsFile(`EDUVANCE_${item.courseCode.replace(/\s+/g, '_')}_Exam.ics`, [item]);
                      showToast(`Downloaded calendar invite for ${item.courseCode}.`, 'success');
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-100"
                  >
                    <CalendarPlus className="w-3.5 h-3.5 text-amber-500" />
                    <span>Add (.ics)</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByDate.map(([dateStr, dayItems]) => (
            <div
              key={dateStr}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                  {new Date(`${dateStr}T00:00:00`).toLocaleDateString('en-KE', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {dayItems.length} paper(s)
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                {dayItems.map((item) => (
                  <div
                    key={item.id}
                    className="border border-slate-200 dark:border-slate-800 rounded-lg p-3.5 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                        {item.courseCode} · {item.startTime}–{formatTimeEnd(item.startTime, item.durationMinutes)}
                      </span>
                      <span className="font-semibold text-slate-500 dark:text-slate-400">{item.examType}</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{item.courseTitle}</p>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{item.venue}</span>
                      <button
                        type="button"
                        onClick={() => {
                          downloadIcsFile(`EDUVANCE_${item.courseCode.replace(/\s+/g, '_')}_Exam.ics`, [item]);
                          showToast(`Downloaded calendar invite for ${item.courseCode}.`, 'success');
                        }}
                        className="text-amber-600 dark:text-amber-400 hover:underline font-medium inline-flex items-center gap-1"
                      >
                        <CalendarPlus className="w-3 h-3" />
                        <span>.ics</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
