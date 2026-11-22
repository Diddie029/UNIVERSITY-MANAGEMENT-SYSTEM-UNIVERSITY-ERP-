import React, { useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  FileUp,
  MonitorPlay,
  Plus,
} from 'lucide-react';
import {
  AssessmentSubmission,
  AssignmentSubmission,
  CourseAssignment,
  OnlineAssessment,
  OnlineClass,
  Student,
} from '../types/erp';

type CalendarEventKind = 'exam' | 'cat' | 'assignment' | 'class';
type CalendarFilterMode = 'all' | 'exams_cats' | 'assignments' | 'classes';

interface CalendarEventItem {
  id: string;
  kind: CalendarEventKind;
  dateKey: string;
  rawDate: string;
  timeLabel: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  typeLabel: string;
  shortTag: 'EXAM' | 'CAT' | 'ASG' | 'CLS';
  marksLabel?: string;
  durationLabel?: string;
  statusLabel: string;
  completedByStudent: boolean;
  assessment?: OnlineAssessment;
  assignment?: CourseAssignment;
  onlineClass?: OnlineClass;
  studentAssessmentSub?: AssessmentSubmission;
  studentAssignmentSub?: AssignmentSubmission;
  submissionCount?: number;
}

interface ExamScheduleCalendarProps {
  assessments: OnlineAssessment[];
  assignments: CourseAssignment[];
  onlineClasses: OnlineClass[];
  assessmentSubmissions: AssessmentSubmission[];
  assignmentSubmissions: AssignmentSubmission[];
  myStudent?: Student;
  isAcademicStaff: boolean;
  onStartAssessment: (asm: OnlineAssessment) => void;
  onReviewAssessment: (asm: OnlineAssessment) => void;
  onOpenAssignmentSubmit: (asg: CourseAssignment) => void;
  onReviewAssignment: (asg: CourseAssignment) => void;
  onOpenClassRoom: (cls: OnlineClass) => void;
  onScheduleAssessmentOnDate?: (dateKey: string) => void;
  onScheduleAssignmentOnDate?: (dateKey: string) => void;
}

const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function toLocalDateKey(dateStr: string): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  const localMatch = /^(\d{4})-(\d{2})-(\d{2})(?:$|T\d{2}:\d{2}(?::\d{2})?$)/.exec(trimmed);
  if (localMatch) {
    return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}`;
  }
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toLocalTimeLabel(dateStr: string): string {
  if (!dateStr) return 'TBA';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return 'TBA';
  return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

function formatReadableDate(dateKey: string): string {
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateKey;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  return d.toLocaleDateString('en-KE', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getRelativeDayLabel(dateKey: string, todayKey: string): { label: string; isPast: boolean; isSoon: boolean } {
  const [y1, m1, d1] = dateKey.split('-').map(Number);
  const [y2, m2, d2] = todayKey.split('-').map(Number);
  const target = new Date(y1, m1 - 1, d1).getTime();
  const today = new Date(y2, m2 - 1, d2).getTime();
  const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return { label: 'Today', isPast: false, isSoon: true };
  if (diffDays === 1) return { label: 'Tomorrow', isPast: false, isSoon: true };
  if (diffDays > 1 && diffDays <= 7) return { label: `In ${diffDays}d`, isPast: false, isSoon: true };
  if (diffDays > 7) return { label: `In ${diffDays}d`, isPast: false, isSoon: false };
  if (diffDays === -1) return { label: 'Yesterday', isPast: true, isSoon: false };
  return { label: `${Math.abs(diffDays)}d ago`, isPast: true, isSoon: false };
}

function getKindChipClasses(kind: CalendarEventKind): string {
  switch (kind) {
    case 'exam':
      return 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/30 hover:border-red-500/60';
    case 'cat':
      return 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:border-amber-500/60';
    case 'assignment':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30 hover:border-blue-500/60';
    case 'class':
      return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:border-emerald-500/60';
  }
}

function getKindTagTextClass(kind: CalendarEventKind): string {
  switch (kind) {
    case 'exam':
      return 'text-red-600 dark:text-red-400';
    case 'cat':
      return 'text-amber-600 dark:text-amber-400';
    case 'assignment':
      return 'text-blue-600 dark:text-blue-400';
    case 'class':
      return 'text-emerald-600 dark:text-emerald-400';
  }
}

export function ExamScheduleCalendar({
  assessments,
  assignments,
  onlineClasses,
  assessmentSubmissions,
  assignmentSubmissions,
  myStudent,
  isAcademicStaff,
  onStartAssessment,
  onReviewAssessment,
  onOpenAssignmentSubmit,
  onReviewAssignment,
  onOpenClassRoom,
  onScheduleAssessmentOnDate,
  onScheduleAssignmentOnDate,
}: ExamScheduleCalendarProps) {
  const now = new Date();
  const todayKey = formatDateKeyFromDate(now);

  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedDateKey, setSelectedDateKey] = useState(todayKey);
  const [filterMode, setFilterMode] = useState<CalendarFilterMode>('all');

  const allEvents = useMemo<CalendarEventItem[]>(() => {
    const items: CalendarEventItem[] = [];

    for (const asm of assessments) {
      const dateKey = toLocalDateKey(asm.dueDate);
      if (!dateKey) continue;
      const mySub = myStudent
        ? assessmentSubmissions.find((s) => s.assessmentId === asm.id && s.studentId === myStudent.id)
        : undefined;
      const subCount = assessmentSubmissions.filter((s) => s.assessmentId === asm.id).length;
      const isExam = asm.assessmentType === 'Online Exam';

      let statusLabel = asm.status === 'published' ? 'Open Window' : asm.status === 'draft' ? 'Draft' : 'Closed';
      if (!isAcademicStaff && mySub) {
        statusLabel = `Submitted · ${mySub.totalScore}/${mySub.maxMarks}`;
      }

      items.push({
        id: `asm_${asm.id}`,
        kind: isExam ? 'exam' : 'cat',
        dateKey,
        rawDate: asm.dueDate,
        timeLabel: toLocalTimeLabel(asm.dueDate),
        courseCode: asm.courseCode,
        courseTitle: asm.courseTitle,
        title: asm.title,
        typeLabel: asm.assessmentType,
        shortTag: isExam ? 'EXAM' : 'CAT',
        marksLabel: `${asm.totalMarks} marks`,
        durationLabel: `${asm.durationMinutes} mins`,
        statusLabel,
        completedByStudent: Boolean(mySub),
        assessment: asm,
        studentAssessmentSub: mySub,
        submissionCount: subCount,
      });
    }

    for (const asg of assignments) {
      const dateKey = toLocalDateKey(asg.dueDate);
      if (!dateKey) continue;
      const mySub = myStudent
        ? assignmentSubmissions.find((s) => s.assignmentId === asg.id && s.studentId === myStudent.id)
        : undefined;
      const subCount = assignmentSubmissions.filter((s) => s.assignmentId === asg.id).length;

      let statusLabel = asg.status === 'open' ? 'Open for Submission' : 'Closed';
      if (!isAcademicStaff && mySub) {
        statusLabel =
          mySub.status === 'graded'
            ? `Graded · ${mySub.score ?? 0}/${asg.maxMarks}`
            : 'Submitted (Awaiting Marking)';
      }

      items.push({
        id: `asg_${asg.id}`,
        kind: 'assignment',
        dateKey,
        rawDate: asg.dueDate,
        timeLabel: toLocalTimeLabel(asg.dueDate),
        courseCode: asg.courseCode,
        courseTitle: asg.courseTitle,
        title: asg.title,
        typeLabel: 'Assignment',
        shortTag: 'ASG',
        marksLabel: `${asg.maxMarks} marks`,
        statusLabel,
        completedByStudent: Boolean(mySub),
        assignment: asg,
        studentAssignmentSub: mySub,
        submissionCount: subCount,
      });
    }

    for (const cls of onlineClasses) {
      const dateKey = toLocalDateKey(cls.scheduledStart);
      if (!dateKey) continue;
      items.push({
        id: `cls_${cls.id}`,
        kind: 'class',
        dateKey,
        rawDate: cls.scheduledStart,
        timeLabel: toLocalTimeLabel(cls.scheduledStart),
        courseCode: cls.courseCode,
        courseTitle: cls.courseTitle,
        title: cls.title,
        typeLabel: `${cls.platform} Class`,
        shortTag: 'CLS',
        durationLabel: `${cls.durationMinutes} mins`,
        statusLabel: cls.status === 'live' ? 'Live Now' : cls.status === 'scheduled' ? 'Scheduled' : 'Completed',
        completedByStudent: false,
        onlineClass: cls,
      });
    }

    return items.sort((a, b) => a.rawDate.localeCompare(b.rawDate));
  }, [assessments, assignments, onlineClasses, assessmentSubmissions, assignmentSubmissions, myStudent, isAcademicStaff]);

  const filteredEvents = useMemo(() => {
    return allEvents.filter((ev) => {
      if (filterMode === 'exams_cats') return ev.kind === 'exam' || ev.kind === 'cat';
      if (filterMode === 'assignments') return ev.kind === 'assignment';
      if (filterMode === 'classes') return ev.kind === 'class';
      return true;
    });
  }, [allEvents, filterMode]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEventItem[]>();
    for (const ev of filteredEvents) {
      const list = map.get(ev.dateKey);
      if (list) list.push(ev);
      else map.set(ev.dateKey, [ev]);
    }
    return map;
  }, [filteredEvents]);

  const monthCells = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    // Monday = 0, Sunday = 6
    const startOffset = (firstDayOfMonth.getDay() + 6) % 7;
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const cells: Array<{ dateKey: string; dayNumber: number; inCurrentMonth: boolean }> = [];
    for (let i = 0; i < totalCells; i++) {
      const cellDate = new Date(viewYear, viewMonth, 1 - startOffset + i);
      cells.push({
        dateKey: formatDateKeyFromDate(cellDate),
        dayNumber: cellDate.getDate(),
        inCurrentMonth: cellDate.getMonth() === viewMonth && cellDate.getFullYear() === viewYear,
      });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`;
  const currentMonthEventCount = useMemo(
    () => filteredEvents.filter((e) => e.dateKey.startsWith(monthPrefix)).length,
    [filteredEvents, monthPrefix]
  );

  const selectedDayEvents = eventsByDate.get(selectedDateKey) ?? [];

  const upcomingTimeline = useMemo(() => {
    const upcoming = filteredEvents.filter((e) => e.dateKey >= todayKey);
    if (upcoming.length > 0) return upcoming.slice(0, 8);
    return filteredEvents.slice(-6).reverse();
  }, [filteredEvents, todayKey]);

  const nextUpcomingEvent = useMemo(
    () => filteredEvents.find((e) => e.dateKey >= todayKey),
    [filteredEvents, todayKey]
  );

  const jumpToDate = (dateKey: string) => {
    const [y, m] = dateKey.split('-').map(Number);
    if (!Number.isNaN(y) && !Number.isNaN(m)) {
      setViewYear(y);
      setViewMonth(m - 1);
    }
    setSelectedDateKey(dateKey);
  };

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const monthTitle = new Date(viewYear, viewMonth, 1).toLocaleDateString('en-KE', {
    month: 'long',
    year: 'numeric',
  });

  const upcomingAssessmentsCount = allEvents.filter(
    (e) => (e.kind === 'exam' || e.kind === 'cat') && e.dateKey >= todayKey
  ).length;
  const upcomingAssignmentsCount = allEvents.filter(
    (e) => e.kind === 'assignment' && e.dateKey >= todayKey
  ).length;
  const upcomingClassesCount = allEvents.filter(
    (e) => e.kind === 'class' && e.dateKey >= todayKey
  ).length;

  return (
    <div className="space-y-5">
      {/* Calendar Navigation & Event-Type Segmented Filter */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="Previous month"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => jumpToDate(todayKey)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 transition-colors"
            >
              Today
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="Next month"
              className="p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
              {monthTitle}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
              {upcomingAssessmentsCount} upcoming CATs/Exams · {upcomingAssignmentsCount} assignments ·{' '}
              {upcomingClassesCount} classes
            </p>
          </div>

          {currentMonthEventCount === 0 && nextUpcomingEvent && (
            <button
              type="button"
              onClick={() => jumpToDate(nextUpcomingEvent.dateKey)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap shrink-0 transition-colors"
            >
              Jump to Next ({nextUpcomingEvent.dateKey})
            </button>
          )}
        </div>

        {/* Interactive Event Type Filter */}
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {(
            [
              { id: 'all', label: 'All Schedule' },
              { id: 'exams_cats', label: 'CATs & Exams' },
              { id: 'assignments', label: 'Assignments' },
              { id: 'classes', label: 'Online Classes' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilterMode(opt.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                filterMode === opt.id
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main Calendar Grid + Selected Day & Upcoming Deadlines Rail */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Monthly Grid */}
        <div className="xl:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden flex flex-col">
          {/* Legend Strip */}
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Assessment &amp; Submission Timetable
            </span>
            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
              <span className="text-red-600 dark:text-red-400 font-semibold">EXAM · Online Exam</span>
              <span aria-hidden="true">·</span>
              <span className="text-amber-600 dark:text-amber-400 font-semibold">CAT · Online CAT</span>
              <span aria-hidden="true">·</span>
              <span className="text-blue-600 dark:text-blue-400 font-semibold">ASG · Assignment</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-600 dark:text-emerald-400 font-semibold">CLS · Live Class</span>
            </div>
          </div>

          {/* Weekday Column Headers */}
          <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
            {WEEKDAY_HEADERS.map((dayName) => (
              <div
                key={dayName}
                className="py-2 px-2 text-center text-xs font-semibold text-slate-600 dark:text-slate-400"
              >
                {dayName}
              </div>
            ))}
          </div>

          {/* 7-Column Calendar Cells */}
          <div className="grid grid-cols-7 flex-1 divide-x divide-y divide-slate-200 dark:divide-slate-800">
            {monthCells.map((cell) => {
              const dayEvents = eventsByDate.get(cell.dateKey) ?? [];
              const isToday = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedDateKey;

              return (
                <div
                  key={cell.dateKey}
                  onClick={() => setSelectedDateKey(cell.dateKey)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedDateKey(cell.dateKey);
                    }
                  }}
                  aria-label={`${formatReadableDate(cell.dateKey)}, ${dayEvents.length} scheduled items`}
                  className={`min-h-[78px] sm:min-h-[104px] p-1.5 sm:p-2 flex flex-col gap-1 text-left cursor-pointer transition-colors min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                    !cell.inCurrentMonth
                      ? 'bg-slate-50/70 dark:bg-slate-900/35 text-slate-400 dark:text-slate-600'
                      : isSelected
                      ? 'bg-amber-500/5 dark:bg-amber-500/10 ring-1 ring-inset ring-amber-500'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span
                      className={`font-mono tabular-nums text-xs leading-none px-1 py-0.5 rounded ${
                        isToday
                          ? 'bg-amber-600 text-white font-bold'
                          : isSelected
                          ? 'text-amber-600 dark:text-amber-400 font-bold'
                          : cell.inCurrentMonth
                          ? 'text-slate-700 dark:text-slate-200 font-medium'
                          : 'text-slate-400 dark:text-slate-600'
                      }`}
                    >
                      {cell.dayNumber}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="hidden sm:inline font-mono tabular-nums text-[10px] text-slate-400 dark:text-slate-500">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1 min-w-0">
                    {dayEvents.slice(0, 3).map((ev) => (
                      <button
                        key={ev.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDateKey(cell.dateKey);
                        }}
                        title={`${ev.typeLabel}: ${ev.courseCode} — ${ev.title} (${ev.timeLabel})`}
                        className={`w-full text-left px-1.5 py-0.5 rounded border text-[10px] sm:text-[11px] leading-tight transition-colors flex items-center justify-between gap-1 min-w-0 ${getKindChipClasses(
                          ev.kind
                        )}`}
                      >
                        <span className="truncate">
                          <strong className="font-mono mr-1">{ev.shortTag}</strong>
                          <span className="hidden md:inline">{ev.courseCode}</span>
                        </span>
                        {ev.completedByStudent && (
                          <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        )}
                      </button>
                    ))}
                    {dayEvents.length > 3 && (
                      <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 pl-1">
                        +{dayEvents.length - 3} more
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Rail: Selected Date Agenda + Upcoming Deadlines Timeline */}
        <div className="xl:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] flex flex-col divide-y divide-slate-200 dark:divide-slate-800">
          {/* Selected Date Agenda */}
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-mono text-amber-600 dark:text-amber-400 font-semibold">
                  Selected Date · {getRelativeDayLabel(selectedDateKey, todayKey).label}
                </p>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {formatReadableDate(selectedDateKey)}
                </h4>
              </div>
              <CalendarDays className="w-4 h-4 text-slate-400 shrink-0 mt-1" />
            </div>

            {selectedDayEvents.length === 0 ? (
              <div className="py-4 space-y-3">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No CATs, exams, assignments, or virtual classes scheduled on this date.
                </p>
                {isAcademicStaff && (onScheduleAssessmentOnDate || onScheduleAssignmentOnDate) && (
                  <div className="flex flex-wrap gap-2">
                    {onScheduleAssessmentOnDate && (
                      <button
                        type="button"
                        onClick={() => onScheduleAssessmentOnDate(selectedDateKey)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-100 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Schedule CAT / Exam</span>
                      </button>
                    )}
                    {onScheduleAssignmentOnDate && (
                      <button
                        type="button"
                        onClick={() => onScheduleAssignmentOnDate(selectedDateKey)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-100 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Post Assignment</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {selectedDayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">
                        <span className={`font-mono font-bold ${getKindTagTextClass(ev.kind)}`}>
                          {ev.shortTag}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {ev.courseCode}
                        </span>
                      </span>
                      <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {ev.timeLabel}
                      </span>
                    </div>

                    <h5 className="text-sm font-semibold text-slate-900 dark:text-white leading-snug">
                      {ev.title}
                    </h5>

                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {ev.typeLabel}
                      {ev.marksLabel ? ` · ${ev.marksLabel}` : ''}
                      {ev.durationLabel ? ` · ${ev.durationLabel}` : ''}
                    </p>

                    <p
                      className={`text-xs font-medium ${
                        ev.completedByStudent
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {ev.statusLabel}
                    </p>

                    <div className="pt-1 flex flex-wrap items-center gap-2">
                      {ev.assessment && !isAcademicStaff && !ev.studentAssessmentSub && ev.assessment.status === 'published' && (
                        <button
                          type="button"
                          onClick={() => onStartAssessment(ev.assessment!)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                        >
                          <Clock className="w-3.5 h-3.5" />
                          <span>Start {ev.assessment.assessmentType}</span>
                        </button>
                      )}
                      {ev.assessment && isAcademicStaff && (
                        <button
                          type="button"
                          onClick={() => onReviewAssessment(ev.assessment!)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          <span>Review ({ev.submissionCount ?? 0})</span>
                        </button>
                      )}
                      {ev.assignment &&
                        !isAcademicStaff &&
                        ev.assignment.status === 'open' &&
                        ev.studentAssignmentSub?.status !== 'graded' && (
                          <button
                            type="button"
                            onClick={() => onOpenAssignmentSubmit(ev.assignment!)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                          >
                            <FileUp className="w-3.5 h-3.5" />
                            <span>{ev.studentAssignmentSub ? 'Update Submission' : 'Submit Work'}</span>
                          </button>
                        )}
                      {ev.assignment && isAcademicStaff && (
                        <button
                          type="button"
                          onClick={() => onReviewAssignment(ev.assignment!)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                        >
                          <ClipboardList className="w-3.5 h-3.5" />
                          <span>Grade ({ev.submissionCount ?? 0})</span>
                        </button>
                      )}
                      {ev.onlineClass && (
                        <button
                          type="button"
                          onClick={() => onOpenClassRoom(ev.onlineClass!)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                        >
                          <MonitorPlay className="w-3.5 h-3.5" />
                          <span>Open Virtual Room</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {isAcademicStaff && (onScheduleAssessmentOnDate || onScheduleAssignmentOnDate) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {onScheduleAssessmentOnDate && (
                      <button
                        type="button"
                        onClick={() => onScheduleAssessmentOnDate(selectedDateKey)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add CAT / Exam</span>
                      </button>
                    )}
                    {onScheduleAssignmentOnDate && (
                      <button
                        type="button"
                        onClick={() => onScheduleAssignmentOnDate(selectedDateKey)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add Assignment</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Upcoming Chronological Deadlines & Exam Feed */}
          <div className="p-5 flex-1 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Upcoming Exams, CATs &amp; Assignment Deadlines
              </h4>
              <span className="font-mono tabular-nums text-xs text-slate-400 dark:text-slate-500">
                {upcomingTimeline.length}
              </span>
            </div>

            {upcomingTimeline.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No upcoming assessments or assignments match the active filter.
              </p>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {upcomingTimeline.map((ev) => {
                  const rel = getRelativeDayLabel(ev.dateKey, todayKey);
                  return (
                    <button
                      key={`up_${ev.id}`}
                      type="button"
                      onClick={() => jumpToDate(ev.dateKey)}
                      className="w-full py-2.5 text-left flex items-start justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40 rounded px-1.5 -mx-1.5 transition-colors"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className={`font-mono font-bold ${getKindTagTextClass(ev.kind)}`}>
                            {ev.shortTag}
                          </span>
                          <span className="text-slate-400" aria-hidden="true">·</span>
                          <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {ev.courseCode}
                          </span>
                          {ev.completedByStudent && (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          )}
                        </div>
                        <p className="text-xs font-medium text-slate-900 dark:text-white truncate">
                          {ev.title}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {ev.dateKey} · {ev.timeLabel}
                          {ev.marksLabel ? ` · ${ev.marksLabel}` : ''}
                        </p>
                      </div>
                      <span
                        className={`font-mono tabular-nums text-[11px] font-semibold shrink-0 pt-0.5 ${
                          rel.isPast
                            ? 'text-slate-400 dark:text-slate-500'
                            : rel.isSoon
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {rel.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
