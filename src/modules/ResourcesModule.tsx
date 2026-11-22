import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  BookOpen,
  Bell,
  CalendarClock,
  CalendarDays,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  FolderUp,
  MonitorPlay,
  Plus,
  Send,
  Trash2,
  UserCheck,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ExamScheduleCalendar } from '../components/ExamScheduleCalendar';
import { StudyGroupsPanel } from '../components/StudyGroupsPanel';
import { ValidatedFileUpload } from '../components/ValidatedFileUpload';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { recordAuditLog, saveExamMarkWithAudit } from '../lib/erpService';
import {
  filterNotificationsForStudent,
  isNotificationRead,
  markAllStudentNotificationsRead,
  markStudentNotificationRead,
} from '../lib/notifications';
import {
  AssessmentAnswer,
  AssessmentQuestion,
  AssessmentSubmission,
  AssignmentSubmission,
  ClassMessage,
  CourseAssignment,
  CourseResource,
  GradingRule,
  OnlineAssessment,
  OnlineClass,
  ResourceType,
  Student,
  StudentNotification,
} from '../types/erp';

interface ResourcesModuleProps {
  data: ErpDataset;
}

type ResourceSubTab =
  | 'materials'
  | 'classes'
  | 'assessments'
  | 'assignments'
  | 'calendar'
  | 'study_groups';

const RESOURCE_TYPES: ResourceType[] = [
  'Textbook / E-Book',
  'Lecture Notes',
  'Past Paper',
  'Lab Manual',
  'Video Lecture',
];

function formatDateTime(isoOrLocal: string): string {
  if (!isoOrLocal) return 'TBA';
  const d = new Date(isoOrLocal);
  if (Number.isNaN(d.getTime())) return isoOrLocal;
  return d.toLocaleString('en-KE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCountdown(secondsLeft: number): string {
  const safe = Math.max(0, Math.floor(secondsLeft));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function ResourcesModule({ data }: ResourcesModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { showToast } = useToast();

  const isSuperAdmin = profile?.role === 'super_admin';
  const isAcademicStaff = [
    'super_admin',
    'management',
    'lecturer',
    'hod',
    'exam_officer',
  ].includes(effectiveRole);

  const [subTab, setSubTab] = useState<ResourceSubTab>('materials');
  const [filterCourseId, setFilterCourseId] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

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

  const myStudent: Student | undefined = useMemo(() => {
    if (effectiveRole !== 'student') return undefined;
    return (
      data.students.find((s) => s.id === profile?.studentId || s.uid === firebaseUser?.uid) ??
      (isSuperAdmin ? data.students[0] : undefined)
    );
  }, [effectiveRole, data.students, profile?.studentId, firebaseUser?.uid, isSuperAdmin]);

  const myRegisteredCourseIds = useMemo(() => {
    if (!myStudent) return new Set<string>();
    return new Set(
      data.registrations
        .filter((r) => r.studentId === myStudent.id && r.status === 'registered')
        .map((r) => r.courseId)
    );
  }, [data.registrations, myStudent]);

  // Notifications Center State
  const [showAlertsPanel, setShowAlertsPanel] = useState(false);
  const [alertsFilter, setAlertsFilter] = useState<'all' | 'grade' | 'assignment' | 'unread'>('all');
  const [showStudyGroupForm, setShowStudyGroupForm] = useState(false);

  // Readers / Modals State
  const [readingResource, setReadingResource] = useState<CourseResource | null>(null);
  const [activeClassRoom, setActiveClassRoom] = useState<OnlineClass | null>(null);
  const [classMessages, setClassMessages] = useState<ClassMessage[]>([]);
  const [chatInput, setChatInput] = useState('');

  // Upload Resource Form State
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resCourseId, setResCourseId] = useState('');
  const [resTitle, setResTitle] = useState('');
  const [resType, setResType] = useState<ResourceType>('Textbook / E-Book');
  const [resAuthor, setResAuthor] = useState('');
  const [resSummary, setResSummary] = useState('');
  const [resContentBody, setResContentBody] = useState('');
  const [resUrl, setResUrl] = useState('');
  const [resFileName, setResFileName] = useState('');
  const [resFileDataUrl, setResFileDataUrl] = useState('');
  const [submittingResource, setSubmittingResource] = useState(false);

  // Schedule Online Class Form State
  const [showClassForm, setShowClassForm] = useState(false);
  const [clsCourseId, setClsCourseId] = useState('');
  const [clsTitle, setClsTitle] = useState('');
  const [clsTopicSummary, setClsTopicSummary] = useState('');
  const [clsPlatform, setClsPlatform] = useState<OnlineClass['platform']>('PUST Virtual Room');
  const [clsMeetingUrl, setClsMeetingUrl] = useState('');
  const [clsPasscode, setClsPasscode] = useState('');
  const [clsStart, setClsStart] = useState('');
  const [clsDuration, setClsDuration] = useState('90');
  const [submittingClass, setSubmittingClass] = useState(false);

  // Online Assessment Builder & Runner State
  const [showAssessmentForm, setShowAssessmentForm] = useState(false);
  const [asmCourseId, setAsmCourseId] = useState('');
  const [asmType, setAsmType] = useState<'Online CAT' | 'Online Exam'>('Online CAT');
  const [asmTitle, setAsmTitle] = useState('');
  const [asmInstructions, setAsmInstructions] = useState('');
  const [asmDuration, setAsmDuration] = useState('45');
  const [asmDueDate, setAsmDueDate] = useState('');
  const [asmQuestions, setAsmQuestions] = useState<AssessmentQuestion[]>([
    {
      id: 'q_1',
      prompt: '',
      kind: 'mcq',
      options: ['', '', '', ''],
      correctOptionIndex: 0,
      marks: 5,
    },
  ]);
  const [submittingAssessment, setSubmittingAssessment] = useState(false);

  // Student Taking Assessment State
  const [takingAssessment, setTakingAssessment] = useState<OnlineAssessment | null>(null);
  const [studentAnswers, setStudentAnswers] = useState<Record<string, AssessmentAnswer>>({});
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const [examTotalSeconds, setExamTotalSeconds] = useState(0);
  const [examDeadlineMs, setExamDeadlineMs] = useState<number | null>(null);
  const [submittingAttempt, setSubmittingAttempt] = useState(false);
  const studentAnswersRef = useRef<Record<string, AssessmentAnswer>>({});
  const autoSubmittedRef = useRef(false);
  const submittingAttemptRef = useRef(false);
  studentAnswersRef.current = studentAnswers;

  // Lecturer Grading Assessment Submissions
  const [reviewingAssessment, setReviewingAssessment] = useState<OnlineAssessment | null>(null);
  const [gradeDrafts, setGradeDrafts] = useState<Record<string, { score: string; feedback: string }>>({});

  // Assignment Form & Submission State
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [asgCourseId, setAsgCourseId] = useState('');
  const [asgTitle, setAsgTitle] = useState('');
  const [asgInstructions, setAsgInstructions] = useState('');
  const [asgDueDate, setAsgDueDate] = useState('');
  const [asgMaxMarks, setAsgMaxMarks] = useState('20');
  const [asgUrl, setAsgUrl] = useState('');
  const [asgFileName, setAsgFileName] = useState('');
  const [asgFileDataUrl, setAsgFileDataUrl] = useState('');
  const [submittingAssignment, setSubmittingAssignment] = useState(false);

  const [activeAssignmentToSubmit, setActiveAssignmentToSubmit] = useState<CourseAssignment | null>(null);
  const [asgSubText, setAsgSubText] = useState('');
  const [asgSubUrl, setAsgSubUrl] = useState('');
  const [asgSubFileName, setAsgSubFileName] = useState('');
  const [asgSubFileDataUrl, setAsgSubFileDataUrl] = useState('');
  const [submittingAsgWork, setSubmittingAsgWork] = useState(false);

  const [reviewingAssignment, setReviewingAssignment] = useState<CourseAssignment | null>(null);
  const [asgGradeDrafts, setAsgGradeDrafts] = useState<Record<string, { score: string; feedback: string }>>({});

  const defaultCourseId = data.courses[0]?.id || '';

  // Subscribe to Virtual Classroom live messages when a classroom is open
  useEffect(() => {
    if (!activeClassRoom) {
      setClassMessages([]);
      return;
    }
    const q = query(
      collection(db, 'online_classes', activeClassRoom.id, 'messages'),
      orderBy('createdAt', 'asc')
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setClassMessages(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ClassMessage, 'id'>) }))
        );
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `online_classes/${activeClassRoom.id}/messages`);
      }
    );
    return () => unsub();
  }, [activeClassRoom]);

  // Keep activeClassRoom synced if lecturer toggles live/completed
  useEffect(() => {
    if (!activeClassRoom) return;
    const latest = data.onlineClasses.find((c) => c.id === activeClassRoom.id);
    if (latest) {
      setActiveClassRoom(latest);
    }
  }, [data.onlineClasses, activeClassRoom]);

  // Wall-clock countdown timer while student takes Online CAT / Exam
  useEffect(() => {
    if (!takingAssessment || examDeadlineMs === null) return;
    const syncClock = () => {
      const remaining = Math.max(0, Math.ceil((examDeadlineMs - Date.now()) / 1000));
      setSecondsRemaining(remaining);
    };
    syncClock();
    const timer = window.setInterval(syncClock, 500);
    return () => window.clearInterval(timer);
  }, [takingAssessment, examDeadlineMs]);

  const matchesCourseAndSearch = (courseId: string, title: string, extraText = '') => {
    if (filterCourseId === 'my_registered') {
      if (myRegisteredCourseIds.size > 0 && !myRegisteredCourseIds.has(courseId)) return false;
    } else if (filterCourseId !== 'all' && courseId !== filterCourseId) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return title.toLowerCase().includes(q) || extraText.toLowerCase().includes(q);
    }
    return true;
  };

  const filteredResources = useMemo(
    () =>
      data.courseResources
        .filter((r) => {
          if (filterType !== 'all' && r.resourceType !== filterType) return false;
          return matchesCourseAndSearch(
            r.courseId,
            r.title,
            `${r.courseCode} ${r.authorOrEdition || ''} ${r.summary || ''}`
          );
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.courseResources, filterCourseId, filterType, searchQuery, myRegisteredCourseIds]
  );

  const filteredClasses = useMemo(
    () =>
      data.onlineClasses
        .filter((c) => matchesCourseAndSearch(c.courseId, c.title, `${c.courseCode} ${c.lecturerName}`))
        .sort((a, b) => {
          const rank = { live: 0, scheduled: 1, completed: 2 };
          if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
          return a.scheduledStart.localeCompare(b.scheduledStart);
        }),
    [data.onlineClasses, filterCourseId, searchQuery, myRegisteredCourseIds]
  );

  const visibleAssessments = useMemo(
    () =>
      data.onlineAssessments
        .filter((a) => {
          if (!isAcademicStaff && a.status === 'draft') return false;
          return matchesCourseAndSearch(a.courseId, a.title, `${a.courseCode} ${a.assessmentType}`);
        })
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.onlineAssessments, isAcademicStaff, filterCourseId, searchQuery, myRegisteredCourseIds]
  );

  const filteredAssignments = useMemo(
    () =>
      data.courseAssignments
        .filter((a) => matchesCourseAndSearch(a.courseId, a.title, `${a.courseCode} ${a.instructions}`))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.courseAssignments, filterCourseId, searchQuery, myRegisteredCourseIds]
  );

  // Handlers: Books & Lecture Materials
  const handleCreateResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const cId = resCourseId || defaultCourseId;
    const course = data.courses.find((c) => c.id === cId);
    if (!course) {
      showToast('Select a valid course unit.', 'error');
      return;
    }
    if (!resUrl.trim() && !resFileDataUrl && !resContentBody.trim()) {
      showToast('Provide a file attachment, external link, or study notes.', 'error');
      return;
    }

    setSubmittingResource(true);
    const id = makeId('res');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'course_resources', id), {
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        title: clampStr(resTitle, 200),
        resourceType: resType,
        authorOrEdition: clampStr(resAuthor, 120),
        summary: clampStr(resSummary, 1200),
        contentBody: clampStr(resContentBody, 8000),
        resourceUrl: clampStr(resUrl, 500),
        fileName: resFileName,
        fileDataUrl: resFileDataUrl,
        uploadedByUid: firebaseUser.uid,
        uploadedByName: clampStr(profile.displayName || 'Lecturer', 160),
        createdAt: now,
        updatedAt: now,
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'COURSE_RESOURCE_UPLOADED',
        `course_resources/${id}`,
        `Uploaded ${resType} "${resTitle}" for ${course.code}.`
      );
      showToast(`Uploaded ${resTitle} to ${course.code}.`, 'success');
      setShowResourceForm(false);
      setResTitle('');
      setResAuthor('');
      setResSummary('');
      setResContentBody('');
      setResUrl('');
      setResFileName('');
      setResFileDataUrl('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `course_resources/${id}`);
    } finally {
      setSubmittingResource(false);
    }
  };

  const handleDeleteResource = async (resource: CourseResource) => {
    try {
      await deleteDoc(doc(db, 'course_resources', resource.id));
      showToast(`Removed "${resource.title}".`, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `course_resources/${resource.id}`);
    }
  };

  // Handlers: Online Classes
  const handleCreateOnlineClass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const cId = clsCourseId || defaultCourseId;
    const course = data.courses.find((c) => c.id === cId);
    if (!course) {
      showToast('Select a valid course unit.', 'error');
      return;
    }

    setSubmittingClass(true);
    const id = makeId('cls');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'online_classes', id), {
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        title: clampStr(clsTitle, 200),
        topicSummary: clampStr(clsTopicSummary, 1000),
        platform: clsPlatform,
        meetingUrl: clampStr(clsMeetingUrl, 500),
        passcode: clampStr(clsPasscode, 64),
        scheduledStart: clampStr(clsStart, 64),
        durationMinutes: Math.min(480, Math.max(10, Number(clsDuration) || 60)),
        status: 'scheduled',
        lecturerUid: firebaseUser.uid,
        lecturerName: clampStr(profile.displayName || 'Lecturer', 160),
        createdAt: now,
        updatedAt: now,
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'ONLINE_CLASS_SCHEDULED',
        `online_classes/${id}`,
        `Scheduled ${course.code} online class "${clsTitle}" on ${clsStart}.`
      );
      showToast(`Scheduled online class for ${course.code}.`, 'success');
      setShowClassForm(false);
      setClsTitle('');
      setClsTopicSummary('');
      setClsMeetingUrl('');
      setClsPasscode('');
      setClsStart('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `online_classes/${id}`);
    } finally {
      setSubmittingClass(false);
    }
  };

  const handleClassStatusChange = async (cls: OnlineClass, nextStatus: OnlineClass['status']) => {
    try {
      await updateDoc(doc(db, 'online_classes', cls.id), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast(
        nextStatus === 'live'
          ? `${cls.courseCode} class is now LIVE.`
          : `${cls.courseCode} class marked as ${nextStatus}.`,
        'success'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `online_classes/${cls.id}`);
    }
  };

  const handleSendClassMessage = async (kind: 'chat' | 'checkin', customBody?: string) => {
    if (!activeClassRoom || !firebaseUser || !profile) return;
    const text = clampStr(customBody ?? chatInput, 1000);
    if (!text) return;
    const msgId = makeId('msg');
    try {
      await setDoc(doc(db, 'online_classes', activeClassRoom.id, 'messages', msgId), {
        classId: activeClassRoom.id,
        senderUid: firebaseUser.uid,
        senderName: clampStr(
          myStudent ? `${myStudent.fullName} (${myStudent.admissionNo})` : profile.displayName,
          160
        ),
        senderRole: isAcademicStaff ? 'lecturer' : 'student',
        kind,
        body: text,
        createdAt: new Date().toISOString(),
      });
      if (kind === 'chat') setChatInput('');
      if (kind === 'checkin') showToast('Checked in as present for this online class.', 'success');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `online_classes/${activeClassRoom.id}/messages/${msgId}`
      );
    }
  };

  // Handlers: Online CATs & Exams
  const handleAddQuestion = (kind: 'mcq' | 'short_answer') => {
    if (asmQuestions.length >= 40) {
      showToast('Maximum of 40 questions per online assessment.', 'error');
      return;
    }
    const nextIdx = asmQuestions.length + 1;
    setAsmQuestions((prev) => [
      ...prev,
      kind === 'mcq'
        ? {
            id: `q_${Date.now()}_${nextIdx}`,
            prompt: '',
            kind: 'mcq',
            options: ['', '', '', ''],
            correctOptionIndex: 0,
            marks: 5,
          }
        : {
            id: `q_${Date.now()}_${nextIdx}`,
            prompt: '',
            kind: 'short_answer',
            marks: 10,
          },
    ]);
  };

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const cId = asmCourseId || defaultCourseId;
    const course = data.courses.find((c) => c.id === cId);
    if (!course) {
      showToast('Select a valid course unit.', 'error');
      return;
    }

    const cleanedQuestions: AssessmentQuestion[] = asmQuestions
      .filter((q) => q.prompt.trim().length > 0)
      .map((q) =>
        q.kind === 'mcq'
          ? {
              id: q.id,
              prompt: clampStr(q.prompt, 500),
              kind: 'mcq',
              options: (q.options || ['', '', '', '']).map((o) => clampStr(o, 200)),
              correctOptionIndex: Number(q.correctOptionIndex ?? 0),
              marks: Math.max(1, Number(q.marks) || 1),
            }
          : {
              id: q.id,
              prompt: clampStr(q.prompt, 500),
              kind: 'short_answer',
              marks: Math.max(1, Number(q.marks) || 5),
            }
      );

    if (cleanedQuestions.length === 0) {
      showToast('Add at least one valid question.', 'error');
      return;
    }
    const totalMarks = Math.min(
      100,
      cleanedQuestions.reduce((sum, q) => sum + Number(q.marks || 0), 0)
    );

    setSubmittingAssessment(true);
    const id = makeId('asm');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'online_assessments', id), {
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        assessmentType: asmType,
        title: clampStr(asmTitle, 200),
        instructions: clampStr(asmInstructions, 1500),
        durationMinutes: Math.min(360, Math.max(5, Number(asmDuration) || 45)),
        dueDate: clampStr(asmDueDate, 64),
        totalMarks,
        status: 'published',
        questions: cleanedQuestions,
        createdByUid: firebaseUser.uid,
        createdByName: clampStr(profile.displayName || 'Lecturer', 160),
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(db, 'student_notifications', makeId('ntf')), {
        targetScope: 'course',
        targetStudentId: '',
        targetStudentUid: '',
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        category: 'assessment',
        title: clampStr(`New ${asmType}: ${asmTitle}`, 200),
        message: clampStr(
          `${course.code} · ${Math.min(360, Math.max(5, Number(asmDuration) || 45))} mins · ${totalMarks} marks · Due ${formatDateTime(asmDueDate)}`,
          600
        ),
        sourceCollection: 'online_assessments',
        sourceId: id,
        isRead: false,
        createdByUid: firebaseUser.uid,
        createdByName: clampStr(
          profile.displayName && profile.displayName.length >= 2 ? profile.displayName : 'Lecturer',
          160
        ),
        createdAt: now,
        updatedAt: now,
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'ONLINE_ASSESSMENT_PUBLISHED',
        `online_assessments/${id}`,
        `Published ${asmType} "${asmTitle}" (${totalMarks} marks) for ${course.code}.`
      );
      showToast(`${asmType} published to ${course.code} students.`, 'success');
      setShowAssessmentForm(false);
      setAsmTitle('');
      setAsmInstructions('');
      setAsmDueDate('');
      setAsmQuestions([
        {
          id: 'q_1',
          prompt: '',
          kind: 'mcq',
          options: ['', '', '', ''],
          correctOptionIndex: 0,
          marks: 5,
        },
      ]);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `online_assessments/${id}`);
    } finally {
      setSubmittingAssessment(false);
    }
  };

  const handleAssessmentStatus = async (
    asm: OnlineAssessment,
    nextStatus: OnlineAssessment['status']
  ) => {
    try {
      await updateDoc(doc(db, 'online_assessments', asm.id), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast(`${asm.title} is now ${nextStatus}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `online_assessments/${asm.id}`);
    }
  };

  const handleStartAssessment = (asm: OnlineAssessment) => {
    const totalSecs = Math.max(1, Number(asm.durationMinutes) || 45) * 60;
    autoSubmittedRef.current = false;
    submittingAttemptRef.current = false;
    studentAnswersRef.current = {};
    setTakingAssessment(asm);
    setStudentAnswers({});
    setExamTotalSeconds(totalSecs);
    setSecondsRemaining(totalSecs);
    setExamDeadlineMs(Date.now() + totalSecs * 1000);
  };

  const closeAssessmentRunner = () => {
    if (submittingAttemptRef.current) return;
    autoSubmittedRef.current = false;
    setExamDeadlineMs(null);
    setExamTotalSeconds(0);
    setSecondsRemaining(0);
    setTakingAssessment(null);
  };

  const submitAssessmentAttempt = useCallback(
    async (isAutoSubmit: boolean) => {
      if (!takingAssessment || !firebaseUser || submittingAttemptRef.current) return;
      if (!myStudent) {
        showToast('No student profile linked to submit this assessment.', 'error');
        return;
      }

      submittingAttemptRef.current = true;
      setSubmittingAttempt(true);
      const currentAnswers = studentAnswersRef.current;
      let autoScore = 0;
      let hasShortAnswer = false;
      const answersList: AssessmentAnswer[] = takingAssessment.questions.map((q) => {
        const ans = currentAnswers[q.id];
        if (q.kind === 'mcq') {
          const picked = ans?.selectedOptionIndex;
          if (picked !== undefined && picked === q.correctOptionIndex) {
            autoScore += Number(q.marks || 0);
          }
          return {
            questionId: q.id,
            answerText:
              picked !== undefined && q.options?.[picked] ? q.options[picked] : 'No selection',
            selectedOptionIndex: picked ?? -1,
          };
        }
        hasShortAnswer = true;
        return {
          questionId: q.id,
          answerText: clampStr(ans?.answerText || '', 1500) || '(No response)',
        };
      });

      const id = makeId('asmsub');
      const now = new Date().toISOString();
      const feedback = isAutoSubmit
        ? hasShortAnswer
          ? 'Auto-submitted upon timer expiry. MCQs auto-scored; short-answer questions awaiting lecturer marking.'
          : 'Auto-submitted & auto-graded upon timer expiry.'
        : hasShortAnswer
          ? 'MCQs auto-scored; short-answer questions awaiting lecturer marking.'
          : 'Auto-graded upon submission.';

      try {
        await setDoc(doc(db, 'assessment_submissions', id), {
          assessmentId: takingAssessment.id,
          assessmentTitle: takingAssessment.title,
          assessmentType: takingAssessment.assessmentType,
          courseId: takingAssessment.courseId,
          courseCode: takingAssessment.courseCode,
          studentId: myStudent.id,
          studentUid: firebaseUser.uid,
          admissionNo: myStudent.admissionNo,
          studentName: myStudent.fullName,
          answers: answersList,
          autoScore,
          totalScore: autoScore,
          maxMarks: takingAssessment.totalMarks,
          status: 'submitted',
          feedback,
          gradedBy: '',
          submittedAt: now,
          updatedAt: now,
        });
        showToast(
          isAutoSubmit
            ? `Time expired — ${takingAssessment.assessmentType} automatically submitted. Auto-score: ${autoScore}/${takingAssessment.totalMarks}.`
            : `${takingAssessment.assessmentType} submitted. Auto-score: ${autoScore}/${takingAssessment.totalMarks}.`,
          isAutoSubmit ? 'info' : 'success'
        );
        setExamDeadlineMs(null);
        setExamTotalSeconds(0);
        setSecondsRemaining(0);
        setTakingAssessment(null);
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `assessment_submissions/${id}`);
      } finally {
        submittingAttemptRef.current = false;
        setSubmittingAttempt(false);
      }
    },
    [takingAssessment, firebaseUser, myStudent, showToast]
  );

  // Auto-submit student exam/CAT response immediately when countdown reaches zero
  useEffect(() => {
    if (!takingAssessment || examDeadlineMs === null) return;
    if (secondsRemaining > 0) return;
    if (autoSubmittedRef.current || submittingAttemptRef.current) return;
    autoSubmittedRef.current = true;
    void submitAssessmentAttempt(true);
  }, [takingAssessment, examDeadlineMs, secondsRemaining, submitAssessmentAttempt]);

  const handleSubmitAssessmentAttempt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingAttemptRef.current) return;
    autoSubmittedRef.current = true;
    await submitAssessmentAttempt(false);
  };

  const handleGradeAssessmentSubmission = async (
    sub: AssessmentSubmission,
    pushToOfficialMarks: boolean
  ) => {
    if (!firebaseUser || !profile || !reviewingAssessment) return;
    const draft = gradeDrafts[sub.id];
    const score = Number(draft?.score ?? sub.totalScore);
    if (Number.isNaN(score) || score < 0 || score > sub.maxMarks) {
      showToast(`Score must be between 0 and ${sub.maxMarks}.`, 'error');
      return;
    }
    const feedback = clampStr(draft?.feedback ?? sub.feedback ?? '', 1000);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'assessment_submissions', sub.id), {
        totalScore: score,
        status: 'graded',
        feedback,
        gradedBy: clampStr(profile.displayName || 'Lecturer', 128),
        updatedAt: now,
      });

      await setDoc(doc(db, 'student_notifications', makeId('ntf')), {
        targetScope: 'student',
        targetStudentId: sub.studentId,
        targetStudentUid: sub.studentUid || '',
        courseId: sub.courseId,
        courseCode: sub.courseCode,
        courseTitle: reviewingAssessment.courseTitle || '',
        category: 'grade',
        title: clampStr(`${sub.assessmentType} Graded: ${score}/${sub.maxMarks}`, 200),
        message: clampStr(
          `${sub.courseCode} · ${reviewingAssessment.title}${feedback ? ` — ${feedback}` : ''}`,
          600
        ),
        sourceCollection: 'assessment_submissions',
        sourceId: sub.id,
        isRead: false,
        createdByUid: firebaseUser.uid,
        createdByName: clampStr(
          profile.displayName && profile.displayName.length >= 2 ? profile.displayName : 'Lecturer',
          160
        ),
        createdAt: now,
        updatedAt: now,
      });

      if (pushToOfficialMarks) {
        const student = data.students.find((s) => s.id === sub.studentId);
        const course = data.courses.find((c) => c.id === sub.courseId);
        const existingMark = data.examMarks.find(
          (m) => m.studentId === sub.studentId && m.courseId === sub.courseId
        );
        if (student && course) {
          const nextCat =
            sub.assessmentType === 'Online CAT'
              ? Math.min(30, Math.round(score))
              : Number(existingMark?.catScore ?? 0);
          const nextExam =
            sub.assessmentType === 'Online Exam'
              ? Math.min(70, Math.round(score))
              : Number(existingMark?.examScore ?? 0);

          await saveExamMarkWithAudit(
            existingMark,
            {
              student,
              courseId: course.id,
              courseCode: course.code,
              courseTitle: course.title,
              creditUnits: course.creditUnits,
              academicYear,
              semesterName,
              catScore: nextCat,
              examScore: nextExam,
              workflowStatus:
                existingMark?.workflowStatus === 'published' ? 'published' : 'submitted',
            },
            customGradingScale,
            { uid: firebaseUser.uid, name: profile.displayName, role: profile.role }
          );
          showToast(`Graded & synced to ${course.code} official exam marks ledger.`, 'success');
          return;
        }
      }
      showToast(`Saved grade (${score}/${sub.maxMarks}) for ${sub.admissionNo}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `assessment_submissions/${sub.id}`);
    }
  };

  // Handlers: Assignments
  const handleCreateAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const cId = asgCourseId || defaultCourseId;
    const course = data.courses.find((c) => c.id === cId);
    if (!course) {
      showToast('Select a valid course unit.', 'error');
      return;
    }

    setSubmittingAssignment(true);
    const id = makeId('asg');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'course_assignments', id), {
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        title: clampStr(asgTitle, 200),
        instructions: clampStr(asgInstructions, 2500),
        dueDate: clampStr(asgDueDate, 64),
        maxMarks: Math.min(100, Math.max(1, Number(asgMaxMarks) || 20)),
        status: 'open',
        resourceUrl: clampStr(asgUrl, 500),
        fileName: asgFileName,
        fileDataUrl: asgFileDataUrl,
        createdByUid: firebaseUser.uid,
        createdByName: clampStr(profile.displayName || 'Lecturer', 160),
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(db, 'student_notifications', makeId('ntf')), {
        targetScope: 'course',
        targetStudentId: '',
        targetStudentUid: '',
        courseId: course.id,
        courseCode: course.code,
        courseTitle: course.title,
        category: 'assignment',
        title: clampStr(`New Assignment: ${asgTitle}`, 200),
        message: clampStr(
          `${course.code} · Due ${formatDateTime(asgDueDate)} · ${Math.min(100, Math.max(1, Number(asgMaxMarks) || 20))} marks`,
          600
        ),
        sourceCollection: 'course_assignments',
        sourceId: id,
        isRead: false,
        createdByUid: firebaseUser.uid,
        createdByName: clampStr(
          profile.displayName && profile.displayName.length >= 2 ? profile.displayName : 'Lecturer',
          160
        ),
        createdAt: now,
        updatedAt: now,
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'ASSIGNMENT_POSTED',
        `course_assignments/${id}`,
        `Posted assignment "${asgTitle}" for ${course.code} (Due ${asgDueDate}).`
      );
      showToast(`Posted assignment for ${course.code}.`, 'success');
      setShowAssignmentForm(false);
      setAsgTitle('');
      setAsgInstructions('');
      setAsgDueDate('');
      setAsgUrl('');
      setAsgFileName('');
      setAsgFileDataUrl('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `course_assignments/${id}`);
    } finally {
      setSubmittingAssignment(false);
    }
  };

  const handleToggleAssignmentStatus = async (asg: CourseAssignment) => {
    const nextStatus = asg.status === 'open' ? 'closed' : 'open';
    try {
      await updateDoc(doc(db, 'course_assignments', asg.id), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast(`Assignment "${asg.title}" marked as ${nextStatus}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `course_assignments/${asg.id}`);
    }
  };

  const openAssignmentSubmitModal = (asg: CourseAssignment) => {
    const existingSub = data.assignmentSubmissions.find(
      (s) => s.assignmentId === asg.id && (myStudent ? s.studentId === myStudent.id : true)
    );
    setActiveAssignmentToSubmit(asg);
    setAsgSubText(existingSub?.submissionText || '');
    setAsgSubUrl(existingSub?.submissionUrl || '');
    setAsgSubFileName(existingSub?.fileName || '');
    setAsgSubFileDataUrl(existingSub?.fileDataUrl || '');
  };

  const handleSubmitAssignmentWork = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeAssignmentToSubmit || !firebaseUser) return;
    if (!myStudent) {
      showToast('No student profile linked to submit assignments.', 'error');
      return;
    }

    const existingSub = data.assignmentSubmissions.find(
      (s) => s.assignmentId === activeAssignmentToSubmit.id && s.studentId === myStudent.id
    );
    const now = new Date().toISOString();
    setSubmittingAsgWork(true);
    try {
      if (existingSub && existingSub.status === 'submitted') {
        await updateDoc(doc(db, 'assignment_submissions', existingSub.id), {
          submissionText: clampStr(asgSubText, 4000),
          submissionUrl: clampStr(asgSubUrl, 500),
          fileName: asgSubFileName,
          fileDataUrl: asgSubFileDataUrl,
          updatedAt: now,
        });
        showToast('Updated your assignment submission.', 'success');
      } else {
        const id = makeId('asgsub');
        await setDoc(doc(db, 'assignment_submissions', id), {
          assignmentId: activeAssignmentToSubmit.id,
          assignmentTitle: activeAssignmentToSubmit.title,
          courseId: activeAssignmentToSubmit.courseId,
          courseCode: activeAssignmentToSubmit.courseCode,
          studentId: myStudent.id,
          studentUid: firebaseUser.uid,
          admissionNo: myStudent.admissionNo,
          studentName: myStudent.fullName,
          submissionText: clampStr(asgSubText, 4000),
          submissionUrl: clampStr(asgSubUrl, 500),
          fileName: asgSubFileName,
          fileDataUrl: asgSubFileDataUrl,
          score: 0,
          maxMarks: activeAssignmentToSubmit.maxMarks,
          status: 'submitted',
          feedback: '',
          gradedBy: '',
          submittedAt: now,
          updatedAt: now,
        });
        showToast(`Submitted "${activeAssignmentToSubmit.title}" successfully.`, 'success');
      }
      setActiveAssignmentToSubmit(null);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `assignment_submissions/${activeAssignmentToSubmit.id}`
      );
    } finally {
      setSubmittingAsgWork(false);
    }
  };

  const handleGradeAssignmentSubmission = async (sub: AssignmentSubmission) => {
    if (!firebaseUser || !profile || !reviewingAssignment) return;
    const draft = asgGradeDrafts[sub.id];
    const score = Number(draft?.score ?? sub.score ?? 0);
    if (Number.isNaN(score) || score < 0 || score > reviewingAssignment.maxMarks) {
      showToast(`Score must be between 0 and ${reviewingAssignment.maxMarks}.`, 'error');
      return;
    }
    const feedback = clampStr(draft?.feedback ?? sub.feedback ?? '', 1000);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'assignment_submissions', sub.id), {
        score,
        maxMarks: reviewingAssignment.maxMarks,
        status: 'graded',
        feedback,
        gradedBy: clampStr(profile.displayName || 'Lecturer', 128),
        updatedAt: now,
      });

      await setDoc(doc(db, 'student_notifications', makeId('ntf')), {
        targetScope: 'student',
        targetStudentId: sub.studentId,
        targetStudentUid: sub.studentUid || '',
        courseId: sub.courseId,
        courseCode: sub.courseCode,
        courseTitle: reviewingAssignment.courseTitle || '',
        category: 'grade',
        title: clampStr(`Assignment Graded: ${score}/${reviewingAssignment.maxMarks}`, 200),
        message: clampStr(
          `${sub.courseCode} · ${reviewingAssignment.title}${feedback ? ` — ${feedback}` : ''}`,
          600
        ),
        sourceCollection: 'assignment_submissions',
        sourceId: sub.id,
        isRead: false,
        createdByUid: firebaseUser.uid,
        createdByName: clampStr(
          profile.displayName && profile.displayName.length >= 2 ? profile.displayName : 'Lecturer',
          160
        ),
        createdAt: now,
        updatedAt: now,
      });

      showToast(`Graded ${sub.admissionNo}: ${score}/${reviewingAssignment.maxMarks}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `assignment_submissions/${sub.id}`);
    }
  };

  const liveClassesCount = data.onlineClasses.filter((c) => c.status === 'live').length;
  const openCatsCount = visibleAssessments.filter((a) => a.status === 'published').length;
  const openAssignmentsCount = data.courseAssignments.filter((a) => a.status === 'open').length;
  const scheduledCalendarCount = visibleAssessments.length + filteredAssignments.length;
  const activeStudyGroupsCount = data.studyGroups.filter((g) => g.status === 'active').length;
  const joinedStudyGroupIdsSet = useMemo(
    () => new Set(data.joinedStudyGroupIds),
    [data.joinedStudyGroupIds]
  );

  const readIdsSet = useMemo(() => new Set(data.notificationReadIds), [data.notificationReadIds]);

  const displayedAlerts = useMemo(() => {
    if (isAcademicStaff) {
      return [...data.studentNotifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
    return filterNotificationsForStudent(
      data.studentNotifications,
      myStudent,
      firebaseUser?.uid,
      myRegisteredCourseIds
    );
  }, [isAcademicStaff, data.studentNotifications, myStudent, firebaseUser?.uid, myRegisteredCourseIds]);

  const unreadAlertsCount = useMemo(() => {
    if (isAcademicStaff) return 0;
    return displayedAlerts.filter((n) => !isNotificationRead(n, readIdsSet)).length;
  }, [isAcademicStaff, displayedAlerts, readIdsSet]);

  const latestUnreadAlert = useMemo(() => {
    if (isAcademicStaff) return undefined;
    return displayedAlerts.find((n) => !isNotificationRead(n, readIdsSet));
  }, [isAcademicStaff, displayedAlerts, readIdsSet]);

  const filteredAlertsList = useMemo(() => {
    return displayedAlerts.filter((n) => {
      if (alertsFilter === 'grade') return n.category === 'grade';
      if (alertsFilter === 'assignment') return n.category === 'assignment' || n.category === 'assessment';
      if (alertsFilter === 'unread') return !isNotificationRead(n, readIdsSet);
      return true;
    });
  }, [displayedAlerts, alertsFilter, readIdsSet]);

  const handleOpenAlert = async (notif: StudentNotification) => {
    if (!isAcademicStaff && firebaseUser && !isNotificationRead(notif, readIdsSet)) {
      await markStudentNotificationRead(notif, firebaseUser.uid, !isSuperAdmin);
    }
    if (notif.category === 'assignment' || notif.sourceCollection === 'assignment_submissions') {
      setSubTab('assignments');
    } else {
      setSubTab('assessments');
    }
    setShowAlertsPanel(false);
  };

  return (
    <div className="space-y-6">
      {/* Header & Top Metrics Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            {isAcademicStaff
              ? 'Learning Resources, Virtual Classes & Online Assessments'
              : 'Student Learning Resources & Virtual Classroom'}
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {academicYear} · {semesterName}
            {myStudent ? ` · ${myStudent.admissionNo} (${myRegisteredCourseIds.size} registered units)` : ''}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sub-Tab Selector */}
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => setSubTab('materials')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'materials'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Books &amp; Notes ({data.courseResources.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('classes')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'classes'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Video className="w-3.5 h-3.5" />
              <span>
                Online Classes ({data.onlineClasses.length}
                {liveClassesCount > 0 ? ` · ${liveClassesCount} Live` : ''})
              </span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('assessments')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'assessments'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Online CATs &amp; Exams ({openCatsCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('assignments')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'assignments'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <FileUp className="w-3.5 h-3.5" />
              <span>Assignments ({openAssignmentsCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('calendar')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'calendar'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span>Exam Calendar ({scheduledCalendarCount})</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('study_groups')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                subTab === 'study_groups'
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Study Groups ({activeStudyGroupsCount})</span>
            </button>
          </div>

          {/* Live Notifications Bell Button */}
          <button
            type="button"
            onClick={() => setShowAlertsPanel((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
              unreadAlertsCount > 0
                ? 'border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-700 dark:text-slate-200 hover:border-amber-500'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span className="font-mono tabular-nums">
              {isAcademicStaff
                ? `Sent Alerts (${displayedAlerts.length})`
                : unreadAlertsCount > 0
                ? `Alerts (${unreadAlertsCount} New)`
                : `Alerts (${displayedAlerts.length})`}
            </span>
          </button>
        </div>
      </div>

      {/* Latest Unread Live Alert Strip (Students) */}
      {!isAcademicStaff && latestUnreadAlert && !showAlertsPanel && (
        <div className="border border-amber-500/40 rounded-xl bg-amber-500/5 dark:bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <Bell className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                <span className="font-mono uppercase text-amber-600 dark:text-amber-400 mr-2">
                  {latestUnreadAlert.category === 'grade'
                    ? 'New Grade'
                    : latestUnreadAlert.category === 'assignment'
                    ? 'New Assignment'
                    : 'New Assessment'}
                </span>
                {latestUnreadAlert.title}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300 truncate">
                {latestUnreadAlert.message} · {formatDateTime(latestUnreadAlert.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleOpenAlert(latestUnreadAlert)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
            >
              View Item
            </button>
            {firebaseUser && (
              <button
                type="button"
                onClick={() => markStudentNotificationRead(latestUnreadAlert, firebaseUser.uid, !isSuperAdmin)}
                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 whitespace-nowrap"
              >
                Mark Read
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowAlertsPanel(true)}
              className="px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap"
            >
              All Alerts ({unreadAlertsCount})
            </button>
          </div>
        </div>
      )}

      {/* Expandable Real-Time Notifications Panel */}
      {showAlertsPanel && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAcademicStaff
                  ? 'Dispatched Student Grade & Assignment Alerts'
                  : 'Real-Time Grade, CAT & Assignment Alerts'}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isAcademicStaff
                  ? 'Live log of alerts automatically dispatched to students when you post assignments or grades.'
                  : 'Live notifications pushed when lecturers post new grades, assignments, or online CATs/exams.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'grade', label: 'Grades' },
                    { id: 'assignment', label: 'Assignments & CATs' },
                    ...(!isAcademicStaff ? [{ id: 'unread', label: `Unread (${unreadAlertsCount})` }] : []),
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setAlertsFilter(opt.id as typeof alertsFilter)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      alertsFilter === opt.id
                        ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {!isAcademicStaff && unreadAlertsCount > 0 && firebaseUser && (
                <button
                  type="button"
                  onClick={() =>
                    markAllStudentNotificationsRead(
                      displayedAlerts,
                      readIdsSet,
                      firebaseUser.uid,
                      !isSuperAdmin
                    )
                  }
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark All Read</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowAlertsPanel(false)}
                aria-label="Close alerts panel"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
            {filteredAlertsList.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No notifications match the selected alert filter.
              </div>
            ) : (
              filteredAlertsList.map((notif) => {
                const isRead = isAcademicStaff ? true : isNotificationRead(notif, readIdsSet);
                return (
                  <div
                    key={notif.id}
                    className={`px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 ${
                      !isRead ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''
                    }`}
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`font-mono font-bold uppercase ${
                            notif.category === 'grade'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : notif.category === 'assignment'
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {notif.category === 'grade'
                            ? 'Grade Posted'
                            : notif.category === 'assignment'
                            ? 'Assignment'
                            : 'CAT / Exam'}
                        </span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          {notif.courseCode}
                        </span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="text-slate-500 dark:text-slate-400">
                          {notif.createdByName}
                        </span>
                        <span className="text-slate-400" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {formatDateTime(notif.createdAt)}
                        </span>
                        {!isRead && (
                          <span className="font-mono text-[11px] font-bold text-amber-600 dark:text-amber-400">
                            · UNREAD
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {notif.title}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-300">{notif.message}</p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleOpenAlert(notif)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                      >
                        Open
                      </button>
                      {!isAcademicStaff && !isRead && firebaseUser && (
                        <button
                          type="button"
                          onClick={() =>
                            markStudentNotificationRead(notif, firebaseUser.uid, !isSuperAdmin)
                          }
                          className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                        >
                          Mark Read
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
          <select
            value={filterCourseId}
            onChange={(e) => setFilterCourseId(e.target.value)}
            aria-label="Filter by course unit"
            className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
          >
            <option value="all">All University Course Units</option>
            {myStudent && myRegisteredCourseIds.size > 0 && (
              <option value="my_registered">My Registered Units Only</option>
            )}
            {data.courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>

          {subTab === 'materials' && (
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              aria-label="Filter by resource type"
              className="px-3 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            >
              <option value="all">All Resource Types</option>
              {RESOURCE_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {rt}
                </option>
              ))}
            </select>
          )}

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, unit code, or lecturer..."
            className="flex-1 min-w-[180px] max-w-xs px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {subTab === 'study_groups' && (
            <button
              type="button"
              onClick={() => setShowStudyGroupForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showStudyGroupForm ? 'Close Form' : 'Create Study Group'}</span>
            </button>
          )}

          {isAcademicStaff && subTab !== 'study_groups' && (
            <>
              {subTab === 'materials' && (
                <button
                  type="button"
                  onClick={() => setShowResourceForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                >
                  <FolderUp className="w-3.5 h-3.5" />
                  <span>{showResourceForm ? 'Close Form' : 'Upload Book / Material'}</span>
                </button>
              )}
              {subTab === 'classes' && (
                <button
                  type="button"
                  onClick={() => setShowClassForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                  <span>{showClassForm ? 'Close Form' : 'Schedule Online Class'}</span>
                </button>
              )}
              {subTab === 'assessments' && (
                <button
                  type="button"
                  onClick={() => setShowAssessmentForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{showAssessmentForm ? 'Close Builder' : 'Create Online CAT / Exam'}</span>
                </button>
              )}
              {subTab === 'assignments' && (
                <button
                  type="button"
                  onClick={() => setShowAssignmentForm((v) => !v)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                >
                  <FileUp className="w-3.5 h-3.5" />
                  <span>{showAssignmentForm ? 'Close Form' : 'Upload Assignment'}</span>
                </button>
              )}
              {subTab === 'calendar' && (
                <button
                  type="button"
                  onClick={() => {
                    setSubTab('assessments');
                    setShowAssessmentForm(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Schedule CAT / Exam</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 1. BOOKS & LEARNING MATERIALS                                         */}
      {/* ===================================================================== */}
      {subTab === 'materials' && (
        <div className="space-y-6">
          {isAcademicStaff && showResourceForm && (
            <form
              onSubmit={handleCreateResource}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Upload Textbook, Lecture Notes, or Course Material
                </h3>
                <button
                  type="button"
                  onClick={() => setShowResourceForm(false)}
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
                    value={resCourseId || defaultCourseId}
                    onChange={(e) => setResCourseId(e.target.value)}
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Material Type
                  </label>
                  <select
                    value={resType}
                    onChange={(e) => setResType(e.target.value as ResourceType)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    {RESOURCE_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {rt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Author / Edition / Module Week
                  </label>
                  <input
                    type="text"
                    value={resAuthor}
                    onChange={(e) => setResAuthor(e.target.value)}
                    placeholder="e.g. Cormen et al., 4th Ed · Week 3"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Resource Title
                  </label>
                  <input
                    type="text"
                    required
                    value={resTitle}
                    onChange={(e) => setResTitle(e.target.value)}
                    placeholder="e.g. Introduction to Algorithms & Balanced Trees"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    External Book / PDF / Video Link (Optional)
                  </label>
                  <input
                    type="url"
                    value={resUrl}
                    onChange={(e) => setResUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Overview / Learning Objectives
                </label>
                <input
                  type="text"
                  value={resSummary}
                  onChange={(e) => setResSummary(e.target.value)}
                  placeholder="Key chapters, syllabus coverage, or reading guidance for students"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Inline Lecture Notes / Chapter Digest (Readable directly in portal)
                </label>
                <textarea
                  rows={4}
                  value={resContentBody}
                  onChange={(e) => setResContentBody(e.target.value)}
                  placeholder="Paste lecture notes, worked formulas, or textbook reading guide..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div className="space-y-3 pt-1">
                <ValidatedFileUpload
                  label="Attach Learning Material (PDF, TXT, Word, Slides)"
                  acceptedExtensions={['.pdf', '.txt', '.md', '.csv', '.doc', '.docx', '.ppt', '.pptx']}
                  fileName={resFileName}
                  isSubmitting={submittingResource}
                  onFileValidated={(name, dataUrl) => {
                    setResFileName(clampStr(name, 180));
                    setResFileDataUrl(dataUrl);
                    showToast(`Validated and attached ${name}.`, 'success');
                  }}
                  onClearFile={() => {
                    setResFileName('');
                    setResFileDataUrl('');
                  }}
                  onValidationError={(msg) => showToast(msg, 'error')}
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingResource}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                  >
                    {submittingResource ? 'Uploading...' : 'Publish Learning Resource'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {filteredResources.length === 0 ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center space-y-2">
              <p className="text-sm font-medium text-slate-900 dark:text-white">
                No books or learning materials match your current filter.
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isAcademicStaff
                  ? 'Click "Upload Book / Material" above to share textbooks, lecture notes, or past papers with students.'
                  : 'Switch course filter to "All University Course Units" or check back after lecturers upload materials.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredResources.map((res) => (
                <article
                  key={res.id}
                  className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>
                        <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                          {res.courseCode}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{res.resourceType}</span>
                      </span>
                      {(isSuperAdmin || res.uploadedByUid === firebaseUser?.uid) && (
                        <button
                          type="button"
                          onClick={() => handleDeleteResource(res)}
                          aria-label={`Delete ${res.title}`}
                          className="text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                      {res.title}
                    </h3>

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {res.authorOrEdition ? `${res.authorOrEdition} · ` : ''}
                      Uploaded by {res.uploadedByName}
                    </p>

                    {res.summary && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-3">
                        {res.summary}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                    {res.contentBody && (
                      <button
                        type="button"
                        onClick={() => setReadingResource(res)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Read Notes</span>
                      </button>
                    )}
                    {res.fileDataUrl && (
                      <a
                        href={res.fileDataUrl}
                        download={res.fileName || `${res.courseCode}_material`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-100"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download {res.fileName ? `(${res.fileName.slice(0, 18)})` : 'File'}</span>
                      </a>
                    )}
                    {res.resourceUrl && (
                      <a
                        href={res.resourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-100"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Open Link</span>
                      </a>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 2. ONLINE CLASSES & VIRTUAL CLASSROOM                                 */}
      {/* ===================================================================== */}
      {subTab === 'classes' && (
        <div className="space-y-6">
          {isAcademicStaff && showClassForm && (
            <form
              onSubmit={handleCreateOnlineClass}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Schedule Live Online Class Session
                </h3>
                <button
                  type="button"
                  onClick={() => setShowClassForm(false)}
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
                    value={clsCourseId || defaultCourseId}
                    onChange={(e) => setClsCourseId(e.target.value)}
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Virtual Platform
                  </label>
                  <select
                    value={clsPlatform}
                    onChange={(e) => setClsPlatform(e.target.value as OnlineClass['platform'])}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    <option value="PUST Virtual Room">PUST Virtual Room (Built-In)</option>
                    <option value="Google Meet">Google Meet</option>
                    <option value="Zoom">Zoom</option>
                    <option value="Microsoft Teams">Microsoft Teams</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Date &amp; Start Time
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={clsStart}
                    onChange={(e) => setClsStart(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Class Topic / Lecture Title
                  </label>
                  <input
                    type="text"
                    required
                    value={clsTitle}
                    onChange={(e) => setClsTitle(e.target.value)}
                    placeholder="e.g. Week 7 Live Lecture: Dijkstra Shortest Path & Heaps"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min={10}
                    max={480}
                    required
                    value={clsDuration}
                    onChange={(e) => setClsDuration(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    External Join Link (Optional if using PUST Virtual Room)
                  </label>
                  <input
                    type="url"
                    value={clsMeetingUrl}
                    onChange={(e) => setClsMeetingUrl(e.target.value)}
                    placeholder="https://meet.google.com/..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Meeting Passcode / Pin (Optional)
                  </label>
                  <input
                    type="text"
                    value={clsPasscode}
                    onChange={(e) => setClsPasscode(e.target.value)}
                    placeholder="e.g. CSC201-LIVE"
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Agenda &amp; Pre-Class Preparation
                </label>
                <textarea
                  rows={2}
                  value={clsTopicSummary}
                  onChange={(e) => setClsTopicSummary(e.target.value)}
                  placeholder="Outline the session objectives and any reading materials to review beforehand."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submittingClass}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                >
                  {submittingClass ? 'Scheduling...' : 'Publish Class Schedule'}
                </button>
              </div>
            </form>
          )}

          {filteredClasses.length === 0 ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No online classes scheduled for the selected course filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {filteredClasses.map((cls) => (
                <div
                  key={cls.id}
                  className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-slate-500 dark:text-slate-400">
                        <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                          {cls.courseCode}
                        </span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span>{cls.platform}</span>
                        <span className="mx-1.5" aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{cls.durationMinutes} mins</span>
                      </span>
                      <span
                        className={`font-semibold uppercase ${
                          cls.status === 'live'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : cls.status === 'scheduled'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {cls.status === 'live' ? 'Live Now' : cls.status}
                      </span>
                    </div>

                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{cls.title}</h3>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      {formatDateTime(cls.scheduledStart)} · {cls.lecturerName}
                      {cls.passcode ? ` · Passcode: ${cls.passcode}` : ''}
                    </p>
                    {cls.topicSummary && (
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                        {cls.topicSummary}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setActiveClassRoom(cls)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                      >
                        <MonitorPlay className="w-3.5 h-3.5" />
                        <span>
                          {cls.status === 'live' ? 'Join Live Classroom' : 'Open Virtual Room'}
                        </span>
                      </button>
                      {cls.meetingUrl && (
                        <a
                          href={cls.meetingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-800 dark:text-slate-100"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>External Link</span>
                        </a>
                      )}
                    </div>

                    {isAcademicStaff && (
                      <div className="flex items-center gap-2">
                        {cls.status === 'scheduled' && (
                          <button
                            type="button"
                            onClick={() => handleClassStatusChange(cls, 'live')}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
                          >
                            Start Class
                          </button>
                        )}
                        {cls.status === 'live' && (
                          <button
                            type="button"
                            onClick={() => handleClassStatusChange(cls, 'completed')}
                            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                          >
                            End Session
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. ONLINE CATS & ONLINE EXAMS                                         */}
      {/* ===================================================================== */}
      {subTab === 'assessments' && (
        <div className="space-y-6">
          {isAcademicStaff && showAssessmentForm && (
            <form
              onSubmit={handleCreateAssessment}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-5"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Create Timed Online CAT or Examination
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAssessmentForm(false)}
                  className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Course Unit
                  </label>
                  <select
                    value={asmCourseId || defaultCourseId}
                    onChange={(e) => setAsmCourseId(e.target.value)}
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Assessment Type
                  </label>
                  <select
                    value={asmType}
                    onChange={(e) => setAsmType(e.target.value as 'Online CAT' | 'Online Exam')}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  >
                    <option value="Online CAT">Online CAT</option>
                    <option value="Online Exam">Online Exam</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min={5}
                    max={360}
                    required
                    value={asmDuration}
                    onChange={(e) => setAsmDuration(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Title
                  </label>
                  <input
                    type="text"
                    required
                    value={asmTitle}
                    onChange={(e) => setAsmTitle(e.target.value)}
                    placeholder="e.g. CAT 1: Complexity Analysis & Linked Lists"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Submission Deadline
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={asmDueDate}
                    onChange={(e) => setAsmDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Examination Instructions
                </label>
                <textarea
                  rows={2}
                  value={asmInstructions}
                  onChange={(e) => setAsmInstructions(e.target.value)}
                  placeholder="Answer all questions within the allocated time window."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              {/* Questions Builder */}
              <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Questions ({asmQuestions.length}) · Total Marks:{' '}
                    <span className="font-mono tabular-nums text-amber-600 dark:text-amber-400">
                      {asmQuestions.reduce((s, q) => s + Number(q.marks || 0), 0)}
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleAddQuestion('mcq')}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500"
                    >
                      + Multiple Choice
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddQuestion('short_answer')}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500"
                    >
                      + Written Answer
                    </button>
                  </div>
                </div>

                {asmQuestions.map((q, qIdx) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                        Q{qIdx + 1} · {q.kind === 'mcq' ? 'Multiple Choice (Auto-Graded)' : 'Structured Written'}
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="text-xs text-slate-500 dark:text-slate-400">Marks:</label>
                        <input
                          type="number"
                          min={1}
                          max={50}
                          value={q.marks}
                          onChange={(e) => {
                            const val = Math.max(1, Number(e.target.value) || 1);
                            setAsmQuestions((prev) =>
                              prev.map((item, idx) => (idx === qIdx ? { ...item, marks: val } : item))
                            );
                          }}
                          className="w-16 px-2 py-1 text-xs font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
                        />
                        {asmQuestions.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setAsmQuestions((prev) => prev.filter((_, idx) => idx !== qIdx))
                            }
                            className="text-slate-400 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <input
                      type="text"
                      required
                      value={q.prompt}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAsmQuestions((prev) =>
                          prev.map((item, idx) => (idx === qIdx ? { ...item, prompt: val } : item))
                        );
                      }}
                      placeholder="Enter question prompt..."
                      className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
                    />

                    {q.kind === 'mcq' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {(q.options || ['', '', '', '']).map((opt, oIdx) => (
                          <div key={oIdx} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={`correct_${q.id}`}
                              checked={(q.correctOptionIndex ?? 0) === oIdx}
                              onChange={() =>
                                setAsmQuestions((prev) =>
                                  prev.map((item, idx) =>
                                    idx === qIdx ? { ...item, correctOptionIndex: oIdx } : item
                                  )
                                )
                              }
                              title="Mark as correct option"
                              className="text-amber-600 focus:ring-amber-500"
                            />
                            <input
                              type="text"
                              required
                              value={opt}
                              onChange={(e) => {
                                const val = e.target.value;
                                setAsmQuestions((prev) =>
                                  prev.map((item, idx) => {
                                    if (idx !== qIdx) return item;
                                    const nextOpts = [...(item.options || ['', '', '', ''])];
                                    nextOpts[oIdx] = val;
                                    return { ...item, options: nextOpts };
                                  })
                                );
                              }}
                              placeholder={`Option ${String.fromCharCode(65 + oIdx)}`}
                              className="flex-1 px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827]"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submittingAssessment}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                >
                  {submittingAssessment ? 'Publishing...' : `Publish ${asmType}`}
                </button>
              </div>
            </form>
          )}

          {visibleAssessments.length === 0 ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No online CATs or examinations currently available for the selected course filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {visibleAssessments.map((asm) => {
                const mySub = myStudent
                  ? data.assessmentSubmissions.find(
                      (s) => s.assessmentId === asm.id && s.studentId === myStudent.id
                    )
                  : undefined;
                const totalSubmissions = data.assessmentSubmissions.filter(
                  (s) => s.assessmentId === asm.id
                ).length;

                return (
                  <div
                    key={asm.id}
                    className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                            {asm.courseCode}
                          </span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{asm.assessmentType}</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{asm.totalMarks} marks</span>
                        </span>
                        <span
                          className={`font-semibold uppercase ${
                            asm.status === 'published'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {asm.status === 'published' ? 'Open' : asm.status}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 dark:text-white">{asm.title}</h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {asm.questions.length} questions · {asm.durationMinutes} mins · Due{' '}
                        {formatDateTime(asm.dueDate)}
                      </p>
                      {asm.instructions && (
                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {asm.instructions}
                        </p>
                      )}

                      {mySub && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1">
                          <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>
                              Submitted · Score:{' '}
                              <span className="font-mono tabular-nums">
                                {mySub.totalScore} / {mySub.maxMarks}
                              </span>{' '}
                              ({mySub.status})
                            </span>
                          </p>
                          {mySub.feedback && (
                            <p className="text-slate-600 dark:text-slate-300">{mySub.feedback}</p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                      {!isAcademicStaff ? (
                        mySub ? (
                          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                            Submitted {formatDateTime(mySub.submittedAt)}
                          </span>
                        ) : asm.status === 'published' ? (
                          <button
                            type="button"
                            onClick={() => handleStartAssessment(asm)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                          >
                            <Clock className="w-3.5 h-3.5" />
                            <span>Start {asm.assessmentType}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Assessment Window Closed
                          </span>
                        )
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 w-full justify-between">
                          <button
                            type="button"
                            onClick={() => setReviewingAssessment(asm)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                            <span>Review Submissions ({totalSubmissions})</span>
                          </button>
                          <div className="flex items-center gap-2">
                            {asm.status === 'published' ? (
                              <button
                                type="button"
                                onClick={() => handleAssessmentStatus(asm, 'closed')}
                                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
                              >
                                Close Window
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAssessmentStatus(asm, 'published')}
                                className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                              >
                                Reopen
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 4. ASSIGNMENTS                                                        */}
      {/* ===================================================================== */}
      {subTab === 'assignments' && (
        <div className="space-y-6">
          {isAcademicStaff && showAssignmentForm && (
            <form
              onSubmit={handleCreateAssignment}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Upload Coursework Assignment
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAssignmentForm(false)}
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
                    value={asgCourseId || defaultCourseId}
                    onChange={(e) => setAsgCourseId(e.target.value)}
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
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Due Date &amp; Time
                  </label>
                  <input
                    type="datetime-local"
                    required
                    value={asgDueDate}
                    onChange={(e) => setAsgDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Max Marks
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={asgMaxMarks}
                    onChange={(e) => setAsgMaxMarks(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Assignment Title
                  </label>
                  <input
                    type="text"
                    required
                    value={asgTitle}
                    onChange={(e) => setAsgTitle(e.target.value)}
                    placeholder="e.g. Lab Assignment 2: Binary Search Tree Implementation"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Reference Brief URL (Optional)
                  </label>
                  <input
                    type="url"
                    value={asgUrl}
                    onChange={(e) => setAsgUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Detailed Instructions &amp; Grading Rubric
                </label>
                <textarea
                  rows={3}
                  required
                  value={asgInstructions}
                  onChange={(e) => setAsgInstructions(e.target.value)}
                  placeholder="Describe deliverables, formatting requirements, and grading criteria..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div className="space-y-3 pt-1">
                <ValidatedFileUpload
                  label="Attach Assignment Brief / Dataset"
                  acceptedExtensions={['.pdf', '.txt', '.md', '.csv', '.doc', '.docx', '.zip']}
                  fileName={asgFileName}
                  isSubmitting={submittingAssignment}
                  onFileValidated={(name, dataUrl) => {
                    setAsgFileName(clampStr(name, 180));
                    setAsgFileDataUrl(dataUrl);
                    showToast(`Validated and attached ${name}.`, 'success');
                  }}
                  onClearFile={() => {
                    setAsgFileName('');
                    setAsgFileDataUrl('');
                  }}
                  onValidationError={(msg) => showToast(msg, 'error')}
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={submittingAssignment}
                    className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                  >
                    {submittingAssignment ? 'Posting...' : 'Publish Assignment'}
                  </button>
                </div>
              </div>
            </form>
          )}

          {filteredAssignments.length === 0 ? (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              No assignments posted for the selected course filter.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {filteredAssignments.map((asg) => {
                const mySub = myStudent
                  ? data.assignmentSubmissions.find(
                      (s) => s.assignmentId === asg.id && s.studentId === myStudent.id
                    )
                  : undefined;
                const subCount = data.assignmentSubmissions.filter(
                  (s) => s.assignmentId === asg.id
                ).length;

                return (
                  <div
                    key={asg.id}
                    className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 flex flex-col justify-between gap-4"
                  >
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                          <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                            {asg.courseCode}
                          </span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{asg.maxMarks} marks</span>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>Due {formatDateTime(asg.dueDate)}</span>
                        </span>
                        <span
                          className={`font-semibold uppercase ${
                            asg.status === 'open'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {asg.status}
                        </span>
                      </div>

                      <h3 className="text-base font-bold text-slate-900 dark:text-white">{asg.title}</h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                        {asg.instructions}
                      </p>

                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        {asg.fileDataUrl && (
                          <a
                            href={asg.fileDataUrl}
                            download={asg.fileName || `${asg.courseCode}_assignment`}
                            className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{asg.fileName || 'Download Brief'}</span>
                          </a>
                        )}
                        {asg.resourceUrl && (
                          <a
                            href={asg.resourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Open Reference Brief</span>
                          </a>
                        )}
                      </div>

                      {mySub && (
                        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 text-xs space-y-1">
                          <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {mySub.status === 'graded'
                              ? `Graded: ${mySub.score ?? 0} / ${asg.maxMarks}`
                              : `Submitted on ${formatDateTime(mySub.submittedAt)} (Awaiting Grading)`}
                          </p>
                          {mySub.feedback && (
                            <p className="text-slate-600 dark:text-slate-300">
                              Lecturer Feedback: {mySub.feedback}
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                      {!isAcademicStaff ? (
                        asg.status === 'open' && mySub?.status !== 'graded' ? (
                          <button
                            type="button"
                            onClick={() => openAssignmentSubmitModal(asg)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                          >
                            <FileUp className="w-3.5 h-3.5" />
                            <span>{mySub ? 'Update Submission' : 'Submit Assignment'}</span>
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {mySub?.status === 'graded'
                              ? `Finalized by ${mySub.gradedBy || 'Lecturer'}`
                              : 'Submissions Closed'}
                          </span>
                        )
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                          <button
                            type="button"
                            onClick={() => setReviewingAssignment(asg)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                            <span>Grade Submissions ({subCount})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleAssignmentStatus(asg)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
                          >
                            {asg.status === 'open' ? 'Close Window' : 'Reopen'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* 5. EXAM, CAT & ASSIGNMENT SCHEDULE CALENDAR                           */}
      {/* ===================================================================== */}
      {subTab === 'calendar' && (
        <ExamScheduleCalendar
          assessments={visibleAssessments}
          assignments={filteredAssignments}
          onlineClasses={filteredClasses}
          assessmentSubmissions={data.assessmentSubmissions}
          assignmentSubmissions={data.assignmentSubmissions}
          myStudent={myStudent}
          isAcademicStaff={isAcademicStaff}
          onStartAssessment={handleStartAssessment}
          onReviewAssessment={(asm) => setReviewingAssessment(asm)}
          onOpenAssignmentSubmit={openAssignmentSubmitModal}
          onReviewAssignment={(asg) => setReviewingAssignment(asg)}
          onOpenClassRoom={(cls) => setActiveClassRoom(cls)}
          onScheduleAssessmentOnDate={(dateKey) => {
            setAsmDueDate(`${dateKey}T09:00`);
            setShowAssessmentForm(true);
            setSubTab('assessments');
          }}
          onScheduleAssignmentOnDate={(dateKey) => {
            setAsgDueDate(`${dateKey}T23:59`);
            setShowAssignmentForm(true);
            setSubTab('assignments');
          }}
        />
      )}

      {/* ===================================================================== */}
      {/* 6. COLLABORATIVE COURSE STUDY GROUPS                                  */}
      {/* ===================================================================== */}
      {subTab === 'study_groups' && (
        <StudyGroupsPanel
          courses={data.courses}
          courseResources={data.courseResources}
          studyGroups={data.studyGroups}
          joinedGroupIds={joinedStudyGroupIdsSet}
          filterCourseId={filterCourseId}
          searchQuery={searchQuery}
          myRegisteredCourseIds={myRegisteredCourseIds}
          myStudent={myStudent}
          isAcademicStaff={isAcademicStaff}
          isSuperAdmin={isSuperAdmin}
          showCreateForm={showStudyGroupForm}
          onToggleCreateForm={setShowStudyGroupForm}
        />
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: INLINE BOOK / NOTES READER                                   */}
      {/* ===================================================================== */}
      {readingResource && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-mono font-semibold">
                  {readingResource.courseCode} · {readingResource.resourceType}
                </p>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {readingResource.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReadingResource(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4 text-sm text-slate-700 dark:text-slate-200">
              {readingResource.summary && (
                <p className="text-xs text-slate-500 dark:text-slate-400">{readingResource.summary}</p>
              )}
              <div className="whitespace-pre-wrap leading-relaxed font-sans">
                {readingResource.contentBody}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Uploaded by {readingResource.uploadedByName}
              </span>
              <button
                type="button"
                onClick={() => setReadingResource(null)}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 text-white"
              >
                Close Reader
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: LIVE VIRTUAL CLASSROOM (CHAT + CHECK-IN + LECTURE STAGE)     */}
      {/* ===================================================================== */}
      {activeClassRoom && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                    {activeClassRoom.courseCode}
                  </span>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span>{activeClassRoom.platform}</span>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="uppercase font-semibold">{activeClassRoom.status}</span>
                </p>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {activeClassRoom.title}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                {!isAcademicStaff && (
                  <button
                    type="button"
                    onClick={() =>
                      handleSendClassMessage(
                        'checkin',
                        `Checked in present (${myStudent?.admissionNo || profile?.displayName || 'Student'})`
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Mark Present</span>
                  </button>
                )}
                {activeClassRoom.meetingUrl && (
                  <a
                    href={activeClassRoom.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Launch Video Call</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setActiveClassRoom(null)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-hidden">
              {/* Session Briefing Stage */}
              <div className="md:col-span-5 p-5 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 space-y-4 overflow-y-auto">
                <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                  <p className="text-xs font-semibold text-slate-900 dark:text-white">
                    Lecturer: {activeClassRoom.lecturerName}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    Start: {formatDateTime(activeClassRoom.scheduledStart)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                    Duration: {activeClassRoom.durationMinutes} minutes
                  </p>
                  {activeClassRoom.passcode && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 font-mono">
                      Passcode: {activeClassRoom.passcode}
                    </p>
                  )}
                </div>

                {activeClassRoom.topicSummary && (
                  <div className="space-y-1">
                    <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Session Agenda
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      {activeClassRoom.topicSummary}
                    </p>
                  </div>
                )}

                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Attendance Check-Ins (
                    <span className="font-mono tabular-nums">
                      {classMessages.filter((m) => m.kind === 'checkin').length}
                    </span>
                    )
                  </h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto text-xs text-slate-600 dark:text-slate-400">
                    {classMessages
                      .filter((m) => m.kind === 'checkin')
                      .map((m) => (
                        <p key={m.id} className="truncate">
                          {m.senderName}
                        </p>
                      ))}
                  </div>
                </div>
              </div>

              {/* Live Q&A / Class Discussion */}
              <div className="md:col-span-7 flex flex-col min-h-[320px] max-h-[60vh]">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Live Classroom Q&amp;A &amp; Announcements
                </div>
                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                  {classMessages.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No messages yet. Post a question or check in to begin the live discussion.
                    </p>
                  ) : (
                    classMessages.map((msg) => (
                      <div key={msg.id} className="text-xs space-y-0.5">
                        <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                          <span
                            className={`font-semibold ${
                              msg.senderRole === 'lecturer'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {msg.senderName}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {new Date(msg.createdAt).toLocaleTimeString('en-KE', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-200">{msg.body}</p>
                      </div>
                    ))
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSendClassMessage('chat');
                  }}
                  className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask a question or post a live class note..."
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                  />
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: STUDENT ONLINE CAT / EXAM RUNNER                             */}
      {/* ===================================================================== */}
      {takingAssessment && (() => {
        const warningThreshold = Math.min(300, Math.max(60, Math.floor(examTotalSeconds * 0.2)));
        const isCriticalTime = secondsRemaining > 0 && secondsRemaining <= warningThreshold;
        const isExpired = secondsRemaining === 0;
        const answeredCount = takingAssessment.questions.filter((q) => {
          const ans = studentAnswers[q.id];
          if (q.kind === 'mcq') return ans?.selectedOptionIndex !== undefined;
          return Boolean(ans?.answerText?.trim());
        }).length;

        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <form
              onSubmit={handleSubmitAssessmentAttempt}
              className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden"
            >
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-mono font-semibold text-amber-600 dark:text-amber-400">
                    {takingAssessment.courseCode} · {takingAssessment.assessmentType}
                  </p>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                    {takingAssessment.title}
                  </h3>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div
                    role="timer"
                    aria-live="polite"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono tabular-nums text-xs font-bold whitespace-nowrap ${
                      isExpired || isCriticalTime
                        ? 'border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    <Clock className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      {isExpired
                        ? 'Time Expired — Auto-Submitting'
                        : isCriticalTime
                        ? `Final Warning · ${formatCountdown(secondsRemaining)}`
                        : `Time Left: ${formatCountdown(secondsRemaining)}`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={closeAssessmentRunner}
                    disabled={submittingAttempt}
                    aria-label="Close assessment window"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <progress
                value={secondsRemaining}
                max={Math.max(1, examTotalSeconds)}
                aria-label="Exam time remaining"
                className={`block w-full h-1.5 appearance-none bg-slate-200 dark:bg-slate-800 [&::-webkit-progress-bar]:bg-slate-200 dark:[&::-webkit-progress-bar]:bg-slate-800 ${
                  isExpired || isCriticalTime
                    ? '[&::-webkit-progress-value]:bg-red-500 [&::-moz-progress-bar]:bg-red-500'
                    : '[&::-webkit-progress-value]:bg-amber-500 [&::-moz-progress-bar]:bg-amber-500'
                }`}
              />

              <div className="p-5 overflow-y-auto space-y-5">
                {takingAssessment.instructions && (
                  <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 p-3 rounded-lg border border-slate-200 dark:border-slate-800">
                    {takingAssessment.instructions}
                  </p>
                )}

                {takingAssessment.questions.map((q, idx) => (
                  <div
                    key={q.id}
                    className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        Question {idx + 1}
                      </span>
                      <span className="font-mono tabular-nums">{q.marks} marks</span>
                    </div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{q.prompt}</p>

                    {q.kind === 'mcq' ? (
                      <div className="space-y-2">
                        {(q.options || []).map((opt, oIdx) => {
                          const checked = studentAnswers[q.id]?.selectedOptionIndex === oIdx;
                          return (
                            <label
                              key={oIdx}
                              className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                                checked
                                  ? 'border-amber-500 bg-amber-500/10 text-slate-900 dark:text-white'
                                  : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                              }`}
                            >
                              <input
                                type="radio"
                                name={`ans_${q.id}`}
                                checked={checked}
                                disabled={submittingAttempt || isExpired}
                                onChange={() =>
                                  setStudentAnswers((prev) => ({
                                    ...prev,
                                    [q.id]: {
                                      questionId: q.id,
                                      answerText: opt,
                                      selectedOptionIndex: oIdx,
                                    },
                                  }))
                                }
                                className="text-amber-600 focus:ring-amber-500"
                              />
                              <span>
                                <strong className="font-mono mr-1.5">
                                  {String.fromCharCode(65 + oIdx)}.
                                </strong>
                                {opt}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <textarea
                        rows={3}
                        disabled={submittingAttempt || isExpired}
                        value={studentAnswers[q.id]?.answerText || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setStudentAnswers((prev) => ({
                            ...prev,
                            [q.id]: { questionId: q.id, answerText: val },
                          }));
                        }}
                        placeholder="Write your response clearly..."
                        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 disabled:opacity-60"
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                  <span>Candidate: {myStudent?.admissionNo || profile?.displayName}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Answered {answeredCount}/{takingAssessment.questions.length}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Auto-submits at 00:00</span>
                </div>
                <button
                  type="submit"
                  disabled={submittingAttempt}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {submittingAttempt
                    ? isExpired
                      ? 'Auto-Submitting...'
                      : 'Submitting...'
                    : `Submit ${takingAssessment.assessmentType}`}
                </button>
              </div>
            </form>
          </div>
        );
      })()}

      {/* ===================================================================== */}
      {/* MODAL 4: LECTURER GRADE ONLINE CAT / EXAM SUBMISSIONS                 */}
      {/* ===================================================================== */}
      {reviewingAssessment && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
                  {reviewingAssessment.courseCode} · {reviewingAssessment.assessmentType} (Max{' '}
                  {reviewingAssessment.totalMarks})
                </p>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Submissions: {reviewingAssessment.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewingAssessment(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {data.assessmentSubmissions.filter((s) => s.assessmentId === reviewingAssessment.id)
                .length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No student submissions recorded yet.
                </p>
              ) : (
                data.assessmentSubmissions
                  .filter((s) => s.assessmentId === reviewingAssessment.id)
                  .map((sub) => {
                    const draft = gradeDrafts[sub.id];
                    return (
                      <div
                        key={sub.id}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            <span className="font-mono text-amber-600 dark:text-amber-400 mr-2">
                              {sub.admissionNo}
                            </span>
                            {sub.studentName}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            Auto MCQ: {sub.autoScore} · Current: {sub.totalScore}/{sub.maxMarks} ({sub.status})
                          </span>
                        </div>

                        <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                          {sub.answers.map((ans, idx) => (
                            <p key={ans.questionId}>
                              <strong className="font-mono">Q{idx + 1}:</strong> {ans.answerText}
                            </p>
                          ))}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 items-center">
                          <div className="md:col-span-2">
                            <input
                              type="number"
                              min={0}
                              max={sub.maxMarks}
                              value={draft?.score ?? String(sub.totalScore)}
                              onChange={(e) =>
                                setGradeDrafts((prev) => ({
                                  ...prev,
                                  [sub.id]: {
                                    score: e.target.value,
                                    feedback: prev[sub.id]?.feedback ?? sub.feedback ?? '',
                                  },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                            />
                          </div>
                          <div className="md:col-span-5">
                            <input
                              type="text"
                              value={draft?.feedback ?? sub.feedback ?? ''}
                              onChange={(e) =>
                                setGradeDrafts((prev) => ({
                                  ...prev,
                                  [sub.id]: {
                                    score: prev[sub.id]?.score ?? String(sub.totalScore),
                                    feedback: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Lecturer remark / feedback..."
                              className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                            />
                          </div>
                          <div className="md:col-span-5 flex flex-wrap justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleGradeAssessmentSubmission(sub, false)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
                            >
                              Save Grade
                            </button>
                            <button
                              type="button"
                              onClick={() => handleGradeAssessmentSubmission(sub, true)}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                            >
                              Sync to Exam Marks
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 5: STUDENT ASSIGNMENT SUBMISSION                                */}
      {/* ===================================================================== */}
      {activeAssignmentToSubmit && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmitAssignmentWork}
            className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
                  {activeAssignmentToSubmit.courseCode} · Due{' '}
                  {formatDateTime(activeAssignmentToSubmit.dueDate)}
                </p>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Submit: {activeAssignmentToSubmit.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveAssignmentToSubmit(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Written Answer / Executive Summary
                </label>
                <textarea
                  rows={5}
                  required
                  value={asgSubText}
                  onChange={(e) => setAsgSubText(e.target.value)}
                  placeholder="Write your solution notes or summary of attached deliverables..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Repository / Google Drive Link (Optional)
                </label>
                <input
                  type="url"
                  value={asgSubUrl}
                  onChange={(e) => setAsgSubUrl(e.target.value)}
                  placeholder="https://github.com/... or https://drive.google.com/..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <ValidatedFileUpload
                label="Attach Work Deliverable (PDF, DOCX, TXT, ZIP)"
                acceptedExtensions={['.pdf', '.txt', '.md', '.csv', '.doc', '.docx', '.zip']}
                fileName={asgSubFileName}
                isSubmitting={submittingAsgWork}
                onFileValidated={(name, dataUrl) => {
                  setAsgSubFileName(clampStr(name, 180));
                  setAsgSubFileDataUrl(dataUrl);
                  showToast(`Validated and attached ${name}.`, 'success');
                }}
                onClearFile={() => {
                  setAsgSubFileName('');
                  setAsgSubFileDataUrl('');
                }}
                onValidationError={(msg) => showToast(msg, 'error')}
              />
            </div>

            <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActiveAssignmentToSubmit(null)}
                className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submittingAsgWork}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
              >
                {submittingAsgWork ? 'Submitting...' : 'Submit Assignment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 6: LECTURER GRADE ASSIGNMENT SUBMISSIONS                        */}
      {/* ===================================================================== */}
      {reviewingAssignment && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <p className="text-xs font-mono text-amber-600 dark:text-amber-400">
                  {reviewingAssignment.courseCode} · Max {reviewingAssignment.maxMarks} marks
                </p>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Submissions: {reviewingAssignment.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setReviewingAssignment(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {data.assignmentSubmissions.filter((s) => s.assignmentId === reviewingAssignment.id)
                .length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No student submissions uploaded yet.
                </p>
              ) : (
                data.assignmentSubmissions
                  .filter((s) => s.assignmentId === reviewingAssignment.id)
                  .map((sub) => {
                    const draft = asgGradeDrafts[sub.id];
                    return (
                      <div
                        key={sub.id}
                        className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-semibold text-slate-900 dark:text-white">
                            <span className="font-mono text-amber-600 dark:text-amber-400 mr-2">
                              {sub.admissionNo}
                            </span>
                            {sub.studentName}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            Submitted {formatDateTime(sub.submittedAt)} · {sub.status}
                          </span>
                        </div>

                        <p className="text-xs text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                          {sub.submissionText}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 text-xs">
                          {sub.fileDataUrl && (
                            <a
                              href={sub.fileDataUrl}
                              download={sub.fileName || `${sub.admissionNo}_submission`}
                              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>{sub.fileName || 'Download Student File'}</span>
                            </a>
                          )}
                          {sub.submissionUrl && (
                            <a
                              href={sub.submissionUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 hover:underline"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Open Submission URL</span>
                            </a>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 items-center">
                          <div className="md:col-span-2">
                            <input
                              type="number"
                              min={0}
                              max={reviewingAssignment.maxMarks}
                              value={draft?.score ?? String(sub.score ?? 0)}
                              onChange={(e) =>
                                setAsgGradeDrafts((prev) => ({
                                  ...prev,
                                  [sub.id]: {
                                    score: e.target.value,
                                    feedback: prev[sub.id]?.feedback ?? sub.feedback ?? '',
                                  },
                                }))
                              }
                              className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                            />
                          </div>
                          <div className="md:col-span-7">
                            <input
                              type="text"
                              value={draft?.feedback ?? sub.feedback ?? ''}
                              onChange={(e) =>
                                setAsgGradeDrafts((prev) => ({
                                  ...prev,
                                  [sub.id]: {
                                    score: prev[sub.id]?.score ?? String(sub.score ?? 0),
                                    feedback: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Enter marking feedback..."
                              className="w-full px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                            />
                          </div>
                          <div className="md:col-span-3 flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleGradeAssignmentSubmission(sub)}
                              className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                            >
                              Save Grade
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
