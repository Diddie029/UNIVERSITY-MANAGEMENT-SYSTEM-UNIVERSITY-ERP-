import React, { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  CheckCircle2,
  Minus,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import {
  AssessmentSubmission,
  AssignmentSubmission,
  Course,
  CourseRegistration,
  ExamMark,
  Student,
  UserRole,
} from '../types/erp';

interface StudentGradeTrendPanelProps {
  student: Student | undefined;
  students: Student[];
  onSelectStudent?: (studentId: string) => void;
  isStaff: boolean;
  effectiveRole: UserRole;
  courses: Course[];
  registrations: CourseRegistration[];
  examMarks: ExamMark[];
  assessmentSubmissions: AssessmentSubmission[];
  assignmentSubmissions: AssignmentSubmission[];
  onJumpToMarks?: (courseId: string) => void;
  onJumpToRegistration?: () => void;
}

interface TimelinePoint {
  id: string;
  dateIso: string;
  dateLabel: string;
  axisLabel: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  sourceType: 'Semester Result' | 'Online CAT' | 'Online Exam' | 'Assignment';
  itemTitle: string;
  scorePct: number;
  rawScoreLabel: string;
  catPct: number | null;
  examPct: number | null;
  grade?: string;
  workflowStatus?: ExamMark['workflowStatus'];
  runningAvgPct: number;
}

type FocusLevel = 'critical' | 'moderate' | 'watch' | 'on_track' | 'pending';

interface SubjectInsight {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  creditUnits: number;
  catPct: number | null;
  examPct: number | null;
  totalScore: number | null;
  courseworkAvgPct: number | null;
  effectiveScorePct: number | null;
  grade: string | null;
  gradePoints: number | null;
  workflowStatus?: ExamMark['workflowStatus'];
  catToExamDelta: number | null;
  assessmentCount: number;
  focusLevel: FocusLevel;
  focusLabel: string;
  focusReason: string;
}

function formatShortDate(iso: string): string {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-KE', { month: 'short', day: 'numeric' });
}

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
    payload?: Record<string, unknown>;
  }>;
  label?: string;
  chartView: 'subjects' | 'timeline';
}

function GradeChartTooltip({ active, payload, chartView }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  if (chartView === 'subjects') {
    const courseCode = String(row.courseCode || '');
    const courseTitle = String(row.courseTitle || '');
    const grade = row.grade ? String(row.grade) : null;
    const effective = typeof row.compositePct === 'number' ? row.compositePct : null;
    const catPct = typeof row.catPct === 'number' ? row.catPct : null;
    const examPct = typeof row.examPct === 'number' ? row.examPct : null;
    const cwPct = typeof row.courseworkAvgPct === 'number' ? row.courseworkAvgPct : null;
    const focusLabel = String(row.focusLabel || '');

    return (
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] px-3.5 py-2.5 shadow-lg text-xs space-y-1.5 min-w-[210px]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-1.5">
          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{courseCode}</span>
          {grade && (
            <span className="font-mono font-bold text-slate-900 dark:text-white">
              Grade {grade}
            </span>
          )}
        </div>
        <p className="font-medium text-slate-800 dark:text-slate-200 leading-snug">{courseTitle}</p>
        <div className="space-y-1 pt-0.5 font-mono tabular-nums text-[11px]">
          {catPct !== null && (
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span>CAT (/30 normalized)</span>
              <span className="font-semibold text-amber-600 dark:text-amber-400">{catPct.toFixed(1)}%</span>
            </div>
          )}
          {examPct !== null && (
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span>Final Exam (/70 norm.)</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">{examPct.toFixed(1)}%</span>
            </div>
          )}
          {cwPct !== null && (
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span>Online Coursework Avg</span>
              <span className="font-semibold text-indigo-600 dark:text-indigo-400">{cwPct.toFixed(1)}%</span>
            </div>
          )}
          {effective !== null && (
            <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-1 text-slate-900 dark:text-white">
              <span className="font-sans font-semibold">Overall Standing</span>
              <span className="font-bold">{effective.toFixed(1)}%</span>
            </div>
          )}
        </div>
        {focusLabel && (
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 pt-0.5">
            {focusLabel}
          </p>
        )}
      </div>
    );
  }

  const courseCode = String(row.courseCode || '');
  const sourceType = String(row.sourceType || '');
  const itemTitle = String(row.itemTitle || '');
  const dateLabel = String(row.dateLabel || '');
  const rawScoreLabel = String(row.rawScoreLabel || '');
  const scorePct = typeof row.scorePct === 'number' ? row.scorePct : 0;
  const runningAvgPct = typeof row.runningAvgPct === 'number' ? row.runningAvgPct : 0;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0F172A] px-3.5 py-2.5 shadow-lg text-xs space-y-1.5 min-w-[220px]">
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-1.5">
        <span className="font-mono font-bold text-amber-600 dark:text-amber-400">{courseCode}</span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">{dateLabel}</span>
      </div>
      <p className="font-medium text-slate-900 dark:text-slate-100">{itemTitle}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">
        {sourceType} · Raw: <span className="font-mono tabular-nums">{rawScoreLabel}</span>
      </p>
      <div className="space-y-1 pt-0.5 font-mono tabular-nums text-[11px]">
        <div className="flex items-center justify-between text-slate-900 dark:text-white">
          <span className="font-sans">Assessment Score</span>
          <span className="font-bold text-amber-600 dark:text-amber-400">{scorePct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
          <span className="font-sans">Running Average</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400">
            {runningAvgPct.toFixed(1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

export function StudentGradeTrendPanel({
  student,
  students,
  onSelectStudent,
  isStaff,
  effectiveRole,
  courses,
  registrations,
  examMarks,
  assessmentSubmissions,
  assignmentSubmissions,
  onJumpToMarks,
  onJumpToRegistration,
}: StudentGradeTrendPanelProps) {
  const { theme } = useTheme();
  const [chartView, setChartView] = useState<'subjects' | 'timeline'>('subjects');
  const [selectedCourseFilter, setSelectedCourseFilter] = useState<string>('ALL');
  const [includeUnpublished, setIncludeUnpublished] = useState<boolean>(isStaff);

  const isDark = theme === 'dark';
  const gridStroke = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(15, 23, 42, 0.08)';
  const axisTickFill = isDark ? '#94A3B8' : '#475569';

  const studentExamMarks = useMemo(() => {
    if (!student) return [];
    return examMarks.filter((m) => {
      if (m.studentId !== student.id) return false;
      if (effectiveRole === 'student' || !includeUnpublished) {
        return m.workflowStatus === 'published';
      }
      return true;
    });
  }, [examMarks, student, effectiveRole, includeUnpublished]);

  const studentAssessments = useMemo(() => {
    if (!student) return [];
    return assessmentSubmissions.filter(
      (s) =>
        s.studentId === student.id &&
        s.maxMarks > 0 &&
        (s.status === 'graded' || s.totalScore > 0 || s.autoScore > 0)
    );
  }, [assessmentSubmissions, student]);

  const studentAssignments = useMemo(() => {
    if (!student) return [];
    return assignmentSubmissions.filter(
      (a) =>
        a.studentId === student.id &&
        a.status === 'graded' &&
        typeof a.score === 'number' &&
        (a.maxMarks ?? 0) > 0
    );
  }, [assignmentSubmissions, student]);

  const studentRegistrations = useMemo(() => {
    if (!student) return [];
    return registrations.filter((r) => r.studentId === student.id && r.status === 'registered');
  }, [registrations, student]);

  // Build chronological timeline points across ExamMarks, Online CAT/Exam submissions, and Graded Assignments
  const allTimelinePoints: TimelinePoint[] = useMemo(() => {
    if (!student) return [];
    const raw: Omit<TimelinePoint, 'runningAvgPct'>[] = [];

    for (const a of studentAssessments) {
      const course = courses.find((c) => c.id === a.courseId);
      const pct = round1((Number(a.totalScore || 0) / Number(a.maxMarks || 1)) * 100);
      const iso = a.updatedAt || a.submittedAt || '';
      raw.push({
        id: `asm_${a.id}`,
        dateIso: iso,
        dateLabel: formatShortDate(iso),
        axisLabel: `${a.courseCode} · ${a.assessmentType === 'Online CAT' ? 'CAT' : 'Online Exam'}`,
        courseId: a.courseId,
        courseCode: a.courseCode,
        courseTitle: course?.title || a.courseCode,
        sourceType: a.assessmentType,
        itemTitle: a.assessmentTitle,
        scorePct: Math.min(100, Math.max(0, pct)),
        rawScoreLabel: `${a.totalScore} / ${a.maxMarks}`,
        catPct: null,
        examPct: null,
      });
    }

    for (const asg of studentAssignments) {
      const course = courses.find((c) => c.id === asg.courseId);
      const maxM = Number(asg.maxMarks || 100);
      const score = Number(asg.score || 0);
      const pct = round1((score / maxM) * 100);
      const iso = asg.updatedAt || asg.submittedAt || '';
      raw.push({
        id: `asg_${asg.id}`,
        dateIso: iso,
        dateLabel: formatShortDate(iso),
        axisLabel: `${asg.courseCode} · Asg`,
        courseId: asg.courseId,
        courseCode: asg.courseCode,
        courseTitle: course?.title || asg.courseCode,
        sourceType: 'Assignment',
        itemTitle: asg.assignmentTitle,
        scorePct: Math.min(100, Math.max(0, pct)),
        rawScoreLabel: `${score} / ${maxM}`,
        catPct: null,
        examPct: null,
      });
    }

    for (const m of studentExamMarks) {
      const course = courses.find((c) => c.id === m.courseId);
      const catPct = round1((Number(m.catScore || 0) / 30) * 100);
      const examPct = round1((Number(m.examScore || 0) / 70) * 100);
      const totalPct = round1(Number(m.totalScore || 0));
      const iso = m.updatedAt || '';
      raw.push({
        id: `mark_${m.id}`,
        dateIso: iso,
        dateLabel: formatShortDate(iso),
        axisLabel: `${m.courseCode} · ${m.grade}`,
        courseId: m.courseId,
        courseCode: m.courseCode,
        courseTitle: m.courseTitle || course?.title || m.courseCode,
        sourceType: 'Semester Result',
        itemTitle: `${m.semesterName} Final Result (${m.workflowStatus})`,
        scorePct: Math.min(100, Math.max(0, totalPct)),
        rawScoreLabel: `${m.totalScore} / 100 (CAT ${m.catScore}/30 · Exam ${m.examScore}/70)`,
        catPct,
        examPct,
        grade: m.grade,
        workflowStatus: m.workflowStatus,
      });
    }

    raw.sort((a, b) => a.dateIso.localeCompare(b.dateIso));

    let cumulativeSum = 0;
    return raw.map((pt, idx) => {
      cumulativeSum += pt.scorePct;
      return {
        ...pt,
        runningAvgPct: round1(cumulativeSum / (idx + 1)),
      };
    });
  }, [student, studentAssessments, studentAssignments, studentExamMarks, courses]);

  const filteredTimelinePoints = useMemo(() => {
    const base =
      selectedCourseFilter === 'ALL'
        ? allTimelinePoints
        : allTimelinePoints.filter((p) => p.courseId === selectedCourseFilter);
    let runningSum = 0;
    return base.map((pt, idx) => {
      runningSum += pt.scorePct;
      return {
        ...pt,
        runningAvgPct: round1(runningSum / (idx + 1)),
      };
    });
  }, [allTimelinePoints, selectedCourseFilter]);

  // Build subject-level diagnostic insights
  const subjectInsights: SubjectInsight[] = useMemo(() => {
    if (!student) return [];
    const courseMap = new Map<
      string,
      { courseId: string; courseCode: string; courseTitle: string; creditUnits: number }
    >();

    for (const r of studentRegistrations) {
      courseMap.set(r.courseId, {
        courseId: r.courseId,
        courseCode: r.courseCode,
        courseTitle: r.courseTitle,
        creditUnits: r.creditUnits || 3,
      });
    }
    for (const m of studentExamMarks) {
      if (!courseMap.has(m.courseId)) {
        const c = courses.find((cr) => cr.id === m.courseId);
        courseMap.set(m.courseId, {
          courseId: m.courseId,
          courseCode: m.courseCode,
          courseTitle: m.courseTitle || c?.title || m.courseCode,
          creditUnits: m.creditUnits || c?.creditUnits || 3,
        });
      }
    }
    for (const a of studentAssessments) {
      if (!courseMap.has(a.courseId)) {
        const c = courses.find((cr) => cr.id === a.courseId);
        courseMap.set(a.courseId, {
          courseId: a.courseId,
          courseCode: a.courseCode,
          courseTitle: c?.title || a.courseCode,
          creditUnits: c?.creditUnits || 3,
        });
      }
    }
    for (const asg of studentAssignments) {
      if (!courseMap.has(asg.courseId)) {
        const c = courses.find((cr) => cr.id === asg.courseId);
        courseMap.set(asg.courseId, {
          courseId: asg.courseId,
          courseCode: asg.courseCode,
          courseTitle: c?.title || asg.courseCode,
          creditUnits: c?.creditUnits || 3,
        });
      }
    }

    const insights: SubjectInsight[] = [];

    for (const meta of courseMap.values()) {
      const mark = studentExamMarks.find((m) => m.courseId === meta.courseId);
      const cwPoints = [
        ...studentAssessments
          .filter((a) => a.courseId === meta.courseId)
          .map((a) => (Number(a.totalScore || 0) / Number(a.maxMarks || 1)) * 100),
        ...studentAssignments
          .filter((asg) => asg.courseId === meta.courseId)
          .map((asg) => (Number(asg.score || 0) / Number(asg.maxMarks || 1)) * 100),
      ];

      const courseworkAvgPct =
        cwPoints.length > 0 ? round1(cwPoints.reduce((s, v) => s + v, 0) / cwPoints.length) : null;

      const catPct = mark ? round1((Number(mark.catScore || 0) / 30) * 100) : null;
      const examPct = mark ? round1((Number(mark.examScore || 0) / 70) * 100) : null;
      const totalScore = mark ? round1(Number(mark.totalScore || 0)) : null;
      const effectiveScorePct = totalScore !== null ? totalScore : courseworkAvgPct;
      const catToExamDelta = catPct !== null && examPct !== null ? round1(examPct - catPct) : null;
      const assessmentCount = cwPoints.length + (mark ? 1 : 0);

      let focusLevel: FocusLevel = 'pending';
      let focusLabel = 'Awaiting Grades';
      let focusReason = 'Registered unit — no scored CATs, assignments, or exam marks yet.';

      if (effectiveScorePct !== null) {
        if (effectiveScorePct < 50) {
          focusLevel = 'critical';
          focusLabel = 'Needs Immediate Focus';
          const gapToPass = round1(50 - effectiveScorePct);
          focusReason =
            catToExamDelta !== null && catToExamDelta <= -10
              ? `${effectiveScorePct.toFixed(1)}% overall (${gapToPass.toFixed(1)} pts below 50% pass). Exam (${examPct?.toFixed(0)}%) dropped sharply from CAT (${catPct?.toFixed(0)}%).`
              : `${effectiveScorePct.toFixed(1)}% is ${gapToPass.toFixed(1)} pts below the 50% Pass threshold — schedule revision & past-paper drills.`;
        } else if (effectiveScorePct < 60) {
          focusLevel = 'moderate';
          focusLabel = 'Moderate Focus';
          const gapToCredit = round1(60 - effectiveScorePct);
          focusReason =
            catToExamDelta !== null && catToExamDelta <= -12
              ? `Exam (${examPct?.toFixed(0)}%) trailed CAT (${catPct?.toFixed(0)}%) by ${Math.abs(catToExamDelta).toFixed(0)} pts; ${gapToCredit.toFixed(1)} pts short of B (Credit).`
              : `Currently at ${effectiveScorePct.toFixed(1)}% (Pass C) — ${gapToCredit.toFixed(1)} pts needed to reach 60% Credit standing.`;
        } else if (catToExamDelta !== null && catToExamDelta <= -12) {
          focusLevel = 'watch';
          focusLabel = 'Exam Gap Watch';
          focusReason = `Overall ${effectiveScorePct.toFixed(1)}% is solid, but Exam (${examPct?.toFixed(0)}%) fell ${Math.abs(catToExamDelta).toFixed(0)} pts below CAT (${catPct?.toFixed(0)}%).`;
        } else {
          focusLevel = 'on_track';
          focusLabel = effectiveScorePct >= 70 ? 'Distinction Standing' : 'On Track';
          focusReason =
            effectiveScorePct >= 70
              ? `Strong mastery at ${effectiveScorePct.toFixed(1)}% (above 70% Distinction benchmark).`
              : `Steady standing at ${effectiveScorePct.toFixed(1)}% — ${round1(70 - effectiveScorePct).toFixed(1)} pts from Distinction.`;
        }
      }

      insights.push({
        courseId: meta.courseId,
        courseCode: meta.courseCode,
        courseTitle: meta.courseTitle,
        creditUnits: meta.creditUnits,
        catPct,
        examPct,
        totalScore,
        courseworkAvgPct,
        effectiveScorePct,
        grade: mark?.grade ?? null,
        gradePoints: typeof mark?.gradePoints === 'number' ? mark.gradePoints : null,
        workflowStatus: mark?.workflowStatus,
        catToExamDelta,
        assessmentCount,
        focusLevel,
        focusLabel,
        focusReason,
      });
    }

    const priorityRank: Record<FocusLevel, number> = {
      critical: 0,
      moderate: 1,
      watch: 2,
      on_track: 3,
      pending: 4,
    };

    insights.sort((a, b) => {
      const rankDiff = priorityRank[a.focusLevel] - priorityRank[b.focusLevel];
      if (rankDiff !== 0) return rankDiff;
      const scoreA = a.effectiveScorePct ?? 999;
      const scoreB = b.effectiveScorePct ?? 999;
      return scoreA - scoreB;
    });

    return insights;
  }, [student, studentRegistrations, studentExamMarks, studentAssessments, studentAssignments, courses]);

  // Chart dataset for Subject Comparison view
  const subjectChartData = useMemo(() => {
    const scored = subjectInsights.filter((s) => s.effectiveScorePct !== null);
    const base =
      selectedCourseFilter === 'ALL'
        ? scored
        : scored.filter((s) => s.courseId === selectedCourseFilter);

    return base.map((s) => ({
      courseId: s.courseId,
      courseCode: s.courseCode,
      courseTitle: s.courseTitle,
      catPct: s.catPct,
      examPct: s.examPct,
      courseworkAvgPct: s.courseworkAvgPct,
      compositePct: s.effectiveScorePct,
      grade: s.grade,
      focusLabel: s.focusLabel,
    }));
  }, [subjectInsights, selectedCourseFilter]);

  // KPI Metrics & Trend Slope
  const summaryStats = useMemo(() => {
    const scoredSubjects = subjectInsights.filter((s) => s.effectiveScorePct !== null);
    const meanScore =
      scoredSubjects.length > 0
        ? round1(
            scoredSubjects.reduce((acc, s) => acc + (s.effectiveScorePct ?? 0), 0) /
              scoredSubjects.length
          )
        : null;

    const gpaSubjects = subjectInsights.filter((s) => s.gradePoints !== null);
    const totalCredits = gpaSubjects.reduce((acc, s) => acc + s.creditUnits, 0);
    const weightedGpa =
      totalCredits > 0
        ? (
            gpaSubjects.reduce((acc, s) => acc + (s.gradePoints ?? 0) * s.creditUnits, 0) /
            totalCredits
          ).toFixed(2)
        : null;

    const sortedByScore = [...scoredSubjects].sort(
      (a, b) => (a.effectiveScorePct ?? 0) - (b.effectiveScorePct ?? 0)
    );
    const weakestSubject = sortedByScore[0] ?? null;
    const strongestSubject = sortedByScore[sortedByScore.length - 1] ?? null;
    const focusNeededCount = scoredSubjects.filter(
      (s) => s.focusLevel === 'critical' || s.focusLevel === 'moderate' || s.focusLevel === 'watch'
    ).length;

    let trendDirection: 'up' | 'down' | 'flat' | 'single' = 'single';
    let trendDelta = 0;
    if (allTimelinePoints.length >= 2) {
      const firstScore = allTimelinePoints[0].scorePct;
      const latestScore = allTimelinePoints[allTimelinePoints.length - 1].scorePct;
      trendDelta = round1(latestScore - firstScore);
      if (trendDelta >= 3) trendDirection = 'up';
      else if (trendDelta <= -3) trendDirection = 'down';
      else trendDirection = 'flat';
    }

    return {
      scoredCount: scoredSubjects.length,
      meanScore,
      weightedGpa,
      weakestSubject,
      strongestSubject,
      focusNeededCount,
      trendDirection,
      trendDelta,
    };
  }, [subjectInsights, allTimelinePoints]);

  if (!student) {
    return (
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
        No student profile selected or linked yet. Sign in via Student Registration No or select a student record.
      </div>
    );
  }

  const hasChartData =
    chartView === 'subjects' ? subjectChartData.length > 0 : filteredTimelinePoints.length > 0;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
              {student.admissionNo}
            </span>
            <span aria-hidden="true">·</span>
            <span>{student.programmeName || student.programmeId}</span>
            <span aria-hidden="true">·</span>
            <span>
              Year {student.yearOfStudy} Sem {student.semester}
            </span>
          </div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Grade Trend &amp; Subject Focus Analysis — {student.fullName}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isStaff && students.length > 0 && onSelectStudent && (
            <select
              aria-label="Select student for grade trend analysis"
              value={student.id}
              onChange={(e) => {
                onSelectStudent(e.target.value);
                setSelectedCourseFilter('ALL');
              }}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.admissionNo} — {s.fullName}
                </option>
              ))}
            </select>
          )}

          {isStaff && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setIncludeUnpublished(true)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  includeUnpublished
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                All Entered Marks
              </button>
              <button
                type="button"
                onClick={() => setIncludeUnpublished(false)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                  !includeUnpublished
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Published Only
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 4-Column KPI Summary Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 space-y-1.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Mean Score &amp; Trajectory</p>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.meanScore !== null ? `${summaryStats.meanScore.toFixed(1)}%` : '—'}
            </span>
            {summaryStats.trendDirection === 'up' && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                <TrendingUp className="w-3.5 h-3.5" />
                +{summaryStats.trendDelta.toFixed(1)}%
              </span>
            )}
            {summaryStats.trendDirection === 'down' && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold font-mono tabular-nums text-red-600 dark:text-red-400">
                <TrendingDown className="w-3.5 h-3.5" />
                {summaryStats.trendDelta.toFixed(1)}%
              </span>
            )}
            {summaryStats.trendDirection === 'flat' && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                <Minus className="w-3.5 h-3.5" />
                Steady ({summaryStats.trendDelta >= 0 ? '+' : ''}
                {summaryStats.trendDelta.toFixed(1)}%)
              </span>
            )}
            {summaryStats.trendDirection === 'single' && summaryStats.scoredCount > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">Baseline</span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            Across {summaryStats.scoredCount} scored unit{summaryStats.scoredCount === 1 ? '' : 's'} ·{' '}
            {allTimelinePoints.length} assessment{allTimelinePoints.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 space-y-1.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Weighted GPA (4.0 Scale)</p>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.weightedGpa ?? '—'}
            </span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              {summaryStats.weightedGpa
                ? Number(summaryStats.weightedGpa) >= 3.5
                  ? 'First Class'
                  : Number(summaryStats.weightedGpa) >= 3.0
                  ? 'Second Upper'
                  : Number(summaryStats.weightedGpa) >= 2.0
                  ? 'Second Lower'
                  : 'Academic Watch'
                : 'No Final GPA'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Target Credit threshold: 60.0% (Grade B)
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 space-y-1.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Strongest Subject</p>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 truncate">
              {summaryStats.strongestSubject ? summaryStats.strongestSubject.courseCode : '—'}
            </span>
            <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {summaryStats.strongestSubject?.effectiveScorePct !== null &&
              summaryStats.strongestSubject?.effectiveScorePct !== undefined
                ? `${summaryStats.strongestSubject.effectiveScorePct.toFixed(1)}%`
                : ''}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {summaryStats.strongestSubject
              ? summaryStats.strongestSubject.courseTitle
              : 'Awaiting scored subjects'}
          </p>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 space-y-1.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">Primary Focus Area</p>
          <div className="flex items-baseline justify-between gap-2">
            {summaryStats.weakestSubject &&
            (summaryStats.weakestSubject.focusLevel === 'critical' ||
              summaryStats.weakestSubject.focusLevel === 'moderate' ||
              summaryStats.weakestSubject.focusLevel === 'watch') ? (
              <>
                <span className="text-lg font-bold font-mono text-red-600 dark:text-red-400 truncate">
                  {summaryStats.weakestSubject.courseCode}
                </span>
                <span className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                  {summaryStats.weakestSubject.effectiveScorePct?.toFixed(1)}%
                </span>
              </>
            ) : summaryStats.scoredCount > 0 ? (
              <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                All Units On Track
              </span>
            ) : (
              <span className="text-lg font-bold text-slate-400">—</span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
            {summaryStats.focusNeededCount > 0
              ? `${summaryStats.focusNeededCount} subject${summaryStats.focusNeededCount === 1 ? '' : 's'} flagged for focus`
              : summaryStats.scoredCount > 0
              ? 'No subjects below 60% target'
              : 'No marks to diagnose yet'}
          </p>
        </div>
      </div>

      {/* Main Analytics Workspace: Chart (8 cols) + Focus Diagnostic List (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Recharts Visualization */}
        <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                {chartView === 'subjects'
                  ? 'Subject-by-Subject Score & Component Breakdown'
                  : 'Chronological Grade Progression & Running Average'}
              </h4>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {chartView === 'subjects'
                  ? 'Compares CAT (/30 normalized), End-Semester Exam (/70 normalized), and overall score against 50% Pass & 60% Credit benchmarks.'
                  : 'Tracks score movement across published semester results, online CATs, and graded assignments over time.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setChartView('subjects')}
                  className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                    chartView === 'subjects'
                      ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  By Subject
                </button>
                <button
                  type="button"
                  onClick={() => setChartView('timeline')}
                  className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
                    chartView === 'timeline'
                      ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Time Trend
                </button>
              </div>

              <select
                aria-label="Filter trend chart by subject"
                value={selectedCourseFilter}
                onChange={(e) => setSelectedCourseFilter(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200"
              >
                <option value="ALL">All Subjects</option>
                {subjectInsights.map((s) => (
                  <option key={s.courseId} value={s.courseId}>
                    {s.courseCode} — {s.courseTitle}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!hasChartData ? (
            <div className="h-[320px] flex flex-col items-center justify-center text-center px-6 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg bg-slate-50/50 dark:bg-slate-900/30 space-y-3">
              <BookOpen className="w-8 h-8 text-slate-400" />
              <div className="space-y-1 max-w-md">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  No scored grades available for this view
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {effectiveRole === 'student'
                    ? 'Once your lecturers publish semester marks or grade your online CATs and assignments, your subject trend will plot here automatically.'
                    : 'Enter CAT & Exam marks in Marks & Exam Workflow or grade online coursework to generate trend analytics for this student.'}
                </p>
              </div>
              {isStaff && onJumpToMarks && courses[0] ? (
                <button
                  type="button"
                  onClick={() => onJumpToMarks(courses[0].id)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                >
                  <span>Go to Marks Entry</span>
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                onJumpToRegistration && (
                  <button
                    type="button"
                    onClick={onJumpToRegistration}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-200"
                  >
                    <span>View Registered Units</span>
                  </button>
                )
              )}
            </div>
          ) : (
            <div className="w-full h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                {chartView === 'subjects' ? (
                  <ComposedChart
                    data={subjectChartData}
                    margin={{ top: 14, right: 18, left: -12, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis
                      dataKey="courseCode"
                      tick={{ fill: axisTickFill, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}
                      axisLine={{ stroke: gridStroke }}
                      tickLine={false}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fill: axisTickFill, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<GradeChartTooltip chartView="subjects" />} />
                    <Legend
                      wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
                    />
                    <ReferenceLine
                      y={60}
                      stroke="#D97706"
                      strokeDasharray="4 4"
                      label={{
                        value: '60% Credit Target',
                        position: 'insideTopRight',
                        fill: '#D97706',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={50}
                      stroke="#DC2626"
                      strokeDasharray="3 3"
                      label={{
                        value: '50% Pass',
                        position: 'insideBottomRight',
                        fill: '#DC2626',
                        fontSize: 11,
                      }}
                    />
                    <Bar
                      dataKey="catPct"
                      name="CAT (%)"
                      fill="#F59E0B"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                    <Bar
                      dataKey="examPct"
                      name="Exam (%)"
                      fill="#3B82F6"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                    <Bar
                      dataKey="courseworkAvgPct"
                      name="Online Coursework (%)"
                      fill="#6366F1"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={28}
                    />
                    <Line
                      type="monotone"
                      dataKey="compositePct"
                      name="Overall Score (%)"
                      stroke="#10B981"
                      strokeWidth={2.5}
                      dot={{ r: 5, fill: '#10B981', strokeWidth: 2, stroke: isDark ? '#111827' : '#FFFFFF' }}
                      activeDot={{ r: 7 }}
                    />
                  </ComposedChart>
                ) : (
                  <AreaChart
                    data={filteredTimelinePoints}
                    margin={{ top: 14, right: 18, left: -12, bottom: 8 }}
                  >
                    <defs>
                      <linearGradient id="gradeScoreGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#F59E0B" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                    <XAxis
                      dataKey="axisLabel"
                      tick={{ fill: axisTickFill, fontSize: 11 }}
                      axisLine={{ stroke: gridStroke }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickFormatter={(v) => `${v}%`}
                      tick={{ fill: axisTickFill, fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<GradeChartTooltip chartView="timeline" />} />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }} />
                    <ReferenceLine
                      y={60}
                      stroke="#D97706"
                      strokeDasharray="4 4"
                      label={{
                        value: '60% Credit Target',
                        position: 'insideTopRight',
                        fill: '#D97706',
                        fontSize: 11,
                      }}
                    />
                    <ReferenceLine
                      y={50}
                      stroke="#DC2626"
                      strokeDasharray="3 3"
                      label={{
                        value: '50% Pass',
                        position: 'insideBottomRight',
                        fill: '#DC2626',
                        fontSize: 11,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="scorePct"
                      name="Assessment Score (%)"
                      stroke="#F59E0B"
                      strokeWidth={2.5}
                      fill="url(#gradeScoreGrad)"
                      dot={{ r: 5, fill: '#F59E0B', strokeWidth: 2, stroke: isDark ? '#111827' : '#FFFFFF' }}
                      activeDot={{ r: 7 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="runningAvgPct"
                      name="Cumulative Average (%)"
                      stroke="#10B981"
                      strokeWidth={2}
                      strokeDasharray="5 4"
                      dot={{ r: 3, fill: '#10B981' }}
                    />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Right: Subjects Needing Focus Diagnostic Panel */}
        <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-500 shrink-0" />
              <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                Subjects Needing Focus
              </h4>
            </div>
            {selectedCourseFilter !== 'ALL' && (
              <button
                type="button"
                onClick={() => setSelectedCourseFilter('ALL')}
                className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap"
              >
                Show All
              </button>
            )}
          </div>

          {subjectInsights.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No registered units or graded courses found for {student.fullName}.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[385px] overflow-y-auto">
              {subjectInsights.map((item) => {
                const isSelected = selectedCourseFilter === item.courseId;
                const statusColor =
                  item.focusLevel === 'critical'
                    ? 'text-red-600 dark:text-red-400'
                    : item.focusLevel === 'moderate' || item.focusLevel === 'watch'
                    ? 'text-amber-600 dark:text-amber-400'
                    : item.focusLevel === 'on_track'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-500 dark:text-slate-400';

                return (
                  <div
                    key={item.courseId}
                    className={`p-4 space-y-2 transition-colors ${
                      isSelected ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                            {item.courseCode}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className={`inline-flex items-center gap-1 font-semibold ${statusColor}`}>
                            {item.focusLevel === 'critical' || item.focusLevel === 'moderate' ? (
                              <AlertTriangle className="w-3 h-3 shrink-0" />
                            ) : item.focusLevel === 'on_track' ? (
                              <CheckCircle2 className="w-3 h-3 shrink-0" />
                            ) : null}
                            <span>{item.focusLabel}</span>
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                          {item.courseTitle}
                        </p>
                      </div>

                      <div className="text-right shrink-0 font-mono tabular-nums">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {item.effectiveScorePct !== null
                            ? `${item.effectiveScorePct.toFixed(1)}%`
                            : '—'}
                        </span>
                        {item.grade && (
                          <span className={`block text-xs font-bold ${statusColor}`}>
                            Grade {item.grade}
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {item.focusReason}
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        {item.catPct !== null && item.examPct !== null
                          ? `CAT ${item.catPct.toFixed(0)}% · Exam ${item.examPct.toFixed(0)}%`
                          : item.courseworkAvgPct !== null
                          ? `Coursework ${item.courseworkAvgPct.toFixed(0)}% (${item.assessmentCount})`
                          : `${item.creditUnits} Credit Units`}
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedCourseFilter(isSelected ? 'ALL' : item.courseId);
                            if (!isSelected && item.assessmentCount > 0) {
                              setChartView('timeline');
                            }
                          }}
                          className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap"
                        >
                          {isSelected ? 'Clear Filter' : 'Inspect Trend'}
                        </button>
                        {isStaff && onJumpToMarks && (
                          <button
                            type="button"
                            onClick={() => onJumpToMarks(item.courseId)}
                            className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:underline whitespace-nowrap"
                          >
                            Edit Marks
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
