import { useEffect, useState } from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  Query,
  DocumentData,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { useAuth } from '../context/AuthContext';
import {
  AcademicCalendar,
  AdmissionApplication,
  AssessmentSubmission,
  AssignmentSubmission,
  AttendanceSession,
  AuditLog,
  Course,
  CourseAssignment,
  CourseRegistration,
  CourseResource,
  Department,
  Employee,
  ExamMark,
  Faculty,
  FeeStructure,
  LeaveRequest,
  Notice,
  NotificationRead,
  OnlineAssessment,
  OnlineClass,
  PaymentSubmission,
  PayrollRun,
  Programme,
  Receipt,
  RoleInvite,
  ScholarshipAward,
  StatutoryConfig,
  Student,
  StudentAccount,
  StudentNotification,
  StudyGroup,
  StudyGroupMembershipIndex,
  SupportTicket,
  UserProfile,
} from '../types/erp';

export interface ErpDataset {
  loading: boolean;
  faculties: Faculty[];
  departments: Department[];
  programmes: Programme[];
  courses: Course[];
  calendars: AcademicCalendar[];
  statutoryConfigs: StatutoryConfig[];
  applications: AdmissionApplication[];
  students: Student[];
  registrations: CourseRegistration[];
  attendanceSessions: AttendanceSession[];
  examMarks: ExamMark[];
  courseResources: CourseResource[];
  onlineClasses: OnlineClass[];
  onlineAssessments: OnlineAssessment[];
  assessmentSubmissions: AssessmentSubmission[];
  courseAssignments: CourseAssignment[];
  assignmentSubmissions: AssignmentSubmission[];
  studentNotifications: StudentNotification[];
  notificationReadIds: string[];
  studyGroups: StudyGroup[];
  joinedStudyGroupIds: string[];
  feeStructures: FeeStructure[];
  studentAccounts: StudentAccount[];
  payments: PaymentSubmission[];
  receipts: Receipt[];
  scholarships: ScholarshipAward[];
  employees: Employee[];
  leaveRequests: LeaveRequest[];
  payrollRuns: PayrollRun[];
  notices: Notice[];
  tickets: SupportTicket[];
  auditLogs: AuditLog[];
  users: UserProfile[];
  roleInvites: RoleInvite[];
}

function subscribeCol<T>(
  q: Query<DocumentData>,
  path: string,
  setter: React.Dispatch<React.SetStateAction<T[]>>,
  onLoaded?: () => void
) {
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) }) as T);
      setter(items);
      if (onLoaded) onLoaded();
    },
    (err) => {
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

function subscribeSingleDoc<T>(
  collectionName: string,
  docId: string,
  setter: React.Dispatch<React.SetStateAction<T[]>>
) {
  return onSnapshot(
    doc(db, collectionName, docId),
    (snap) => {
      if (snap.exists()) {
        setter([{ id: snap.id, ...(snap.data() as Omit<T, 'id'>) } as T]);
      } else {
        setter([]);
      }
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `${collectionName}/${docId}`);
    }
  );
}

export function useErpData(): ErpDataset {
  const { firebaseUser, profile, actualRole, authReady } = useAuth();
  const uid = firebaseUser?.uid ?? null;
  const boundStudentId = profile?.studentId || '';
  const boundEmployeeId = profile?.employeeId || '';

  const [loading, setLoading] = useState(true);
  const [faculties, setFaculties] = useState<Faculty[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [calendars, setCalendars] = useState<AcademicCalendar[]>([]);
  const [statutoryConfigs, setStatutoryConfigs] = useState<StatutoryConfig[]>([]);
  const [applications, setApplications] = useState<AdmissionApplication[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [registrations, setRegistrations] = useState<CourseRegistration[]>([]);
  const [attendanceSessions, setAttendanceSessions] = useState<AttendanceSession[]>([]);
  const [examMarks, setExamMarks] = useState<ExamMark[]>([]);
  const [courseResources, setCourseResources] = useState<CourseResource[]>([]);
  const [onlineClasses, setOnlineClasses] = useState<OnlineClass[]>([]);
  const [onlineAssessments, setOnlineAssessments] = useState<OnlineAssessment[]>([]);
  const [assessmentSubmissions, setAssessmentSubmissions] = useState<AssessmentSubmission[]>([]);
  const [courseAssignments, setCourseAssignments] = useState<CourseAssignment[]>([]);
  const [assignmentSubmissions, setAssignmentSubmissions] = useState<AssignmentSubmission[]>([]);
  const [courseNotifications, setCourseNotifications] = useState<StudentNotification[]>([]);
  const [personalNotifications, setPersonalNotifications] = useState<StudentNotification[]>([]);
  const [notificationReads, setNotificationReads] = useState<NotificationRead[]>([]);
  const [studyGroups, setStudyGroups] = useState<StudyGroup[]>([]);
  const [studyGroupMemberships, setStudyGroupMemberships] = useState<StudyGroupMembershipIndex[]>([]);
  const [feeStructures, setFeeStructures] = useState<FeeStructure[]>([]);
  const [studentAccounts, setStudentAccounts] = useState<StudentAccount[]>([]);
  const [payments, setPayments] = useState<PaymentSubmission[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [scholarships, setScholarships] = useState<ScholarshipAward[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [roleInvites, setRoleInvites] = useState<RoleInvite[]>([]);

  // Public Catalog Subscriptions (safe pre-auth and post-auth)
  useEffect(() => {
    const unsubs = [
      subscribeCol<Faculty>(collection(db, 'faculties'), 'faculties', setFaculties, () => setLoading(false)),
      subscribeCol<Department>(collection(db, 'departments'), 'departments', setDepartments),
      subscribeCol<Programme>(collection(db, 'programmes'), 'programmes', setProgrammes),
      subscribeCol<Course>(collection(db, 'courses'), 'courses', setCourses),
      subscribeCol<AcademicCalendar>(collection(db, 'academic_calendars'), 'academic_calendars', setCalendars),
      subscribeCol<FeeStructure>(collection(db, 'fee_structures'), 'fee_structures', setFeeStructures),
      subscribeCol<Notice>(collection(db, 'notices'), 'notices', setNotices),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Role-Scoped Authenticated Subscriptions
  useEffect(() => {
    const hasPasswordProvider = firebaseUser?.providerData?.some((p) => p.providerId === 'password');
    const isVerifiedSession = Boolean(firebaseUser?.emailVerified || hasPasswordProvider);

    if (!authReady || !uid || !isVerifiedSession) {
      setApplications([]);
      setStudents([]);
      setRegistrations([]);
      setAttendanceSessions([]);
      setExamMarks([]);
      setCourseResources([]);
      setOnlineClasses([]);
      setOnlineAssessments([]);
      setAssessmentSubmissions([]);
      setCourseAssignments([]);
      setAssignmentSubmissions([]);
      setCourseNotifications([]);
      setPersonalNotifications([]);
      setNotificationReads([]);
      setStudyGroups([]);
      setStudyGroupMemberships([]);
      setStudentAccounts([]);
      setPayments([]);
      setReceipts([]);
      setScholarships([]);
      setEmployees([]);
      setLeaveRequests([]);
      setPayrollRuns([]);
      setTickets([]);
      setAuditLogs([]);
      setUsers([]);
      setRoleInvites([]);
      return;
    }

    const unsubs: (() => void)[] = [];
    const isAdmin = actualRole === 'super_admin';
    const isMgmt = isAdmin || actualRole === 'management';
    const isAdm = isMgmt || actualRole === 'admissions';
    const isAcad = isMgmt || ['lecturer', 'hod', 'exam_officer'].includes(actualRole);
    const isFin = isMgmt || actualRole === 'finance';
    const isHr = isMgmt || actualRole === 'hr';
    const isStaff = isAdm || isAcad || isFin || isHr;

    unsubs.push(subscribeCol<StatutoryConfig>(collection(db, 'statutory_configs'), 'statutory_configs', setStatutoryConfigs));

    if (isMgmt) {
      unsubs.push(subscribeCol<UserProfile>(collection(db, 'users'), 'users', setUsers));
    } else {
      setUsers([]);
    }

    if (isAdmin) {
      unsubs.push(subscribeCol<RoleInvite>(collection(db, 'role_invites'), 'role_invites', setRoleInvites));
    } else {
      setRoleInvites([]);
    }

    if (isAdm) {
      unsubs.push(subscribeCol<AdmissionApplication>(collection(db, 'applications'), 'applications', setApplications));
    } else {
      unsubs.push(
        subscribeCol<AdmissionApplication>(
          query(collection(db, 'applications'), where('applicantUid', '==', uid)),
          'applications',
          setApplications
        )
      );
    }

    if (isAdm || isAcad || isFin) {
      unsubs.push(subscribeCol<Student>(collection(db, 'students'), 'students', setStudents));
      unsubs.push(subscribeCol<CourseRegistration>(collection(db, 'course_registrations'), 'course_registrations', setRegistrations));
    } else if (actualRole === 'student') {
      if (boundStudentId) {
        unsubs.push(subscribeSingleDoc<Student>('students', boundStudentId, setStudents));
        unsubs.push(
          subscribeCol<CourseRegistration>(
            query(collection(db, 'course_registrations'), where('studentId', '==', boundStudentId)),
            'course_registrations',
            setRegistrations
          )
        );
      } else {
        unsubs.push(
          subscribeCol<Student>(query(collection(db, 'students'), where('uid', '==', uid)), 'students', setStudents)
        );
        unsubs.push(
          subscribeCol<CourseRegistration>(
            query(collection(db, 'course_registrations'), where('studentUid', '==', uid)),
            'course_registrations',
            setRegistrations
          )
        );
      }
    } else {
      setStudents([]);
      setRegistrations([]);
    }

    if (isAcad) {
      unsubs.push(subscribeCol<AttendanceSession>(collection(db, 'attendance_sessions'), 'attendance_sessions', setAttendanceSessions));
      unsubs.push(subscribeCol<ExamMark>(collection(db, 'exam_marks'), 'exam_marks', setExamMarks));
      unsubs.push(subscribeCol<CourseResource>(collection(db, 'course_resources'), 'course_resources', setCourseResources));
      unsubs.push(subscribeCol<OnlineClass>(collection(db, 'online_classes'), 'online_classes', setOnlineClasses));
      unsubs.push(subscribeCol<OnlineAssessment>(collection(db, 'online_assessments'), 'online_assessments', setOnlineAssessments));
      unsubs.push(subscribeCol<AssessmentSubmission>(collection(db, 'assessment_submissions'), 'assessment_submissions', setAssessmentSubmissions));
      unsubs.push(subscribeCol<CourseAssignment>(collection(db, 'course_assignments'), 'course_assignments', setCourseAssignments));
      unsubs.push(subscribeCol<AssignmentSubmission>(collection(db, 'assignment_submissions'), 'assignment_submissions', setAssignmentSubmissions));
      unsubs.push(subscribeCol<StudentNotification>(collection(db, 'student_notifications'), 'student_notifications', setCourseNotifications));
      setPersonalNotifications([]);
      unsubs.push(subscribeCol<NotificationRead>(collection(db, 'users', uid, 'notification_reads'), `users/${uid}/notification_reads`, setNotificationReads));
      unsubs.push(subscribeCol<StudyGroup>(collection(db, 'study_groups'), 'study_groups', setStudyGroups));
      unsubs.push(subscribeCol<StudyGroupMembershipIndex>(collection(db, 'users', uid, 'study_group_memberships'), `users/${uid}/study_group_memberships`, setStudyGroupMemberships));
    } else if (actualRole === 'student') {
      setAttendanceSessions([]);
      unsubs.push(subscribeCol<CourseResource>(collection(db, 'course_resources'), 'course_resources', setCourseResources));
      unsubs.push(subscribeCol<OnlineClass>(collection(db, 'online_classes'), 'online_classes', setOnlineClasses));
      unsubs.push(subscribeCol<StudyGroup>(collection(db, 'study_groups'), 'study_groups', setStudyGroups));
      unsubs.push(
        subscribeCol<StudyGroupMembershipIndex>(
          collection(db, 'users', uid, 'study_group_memberships'),
          `users/${uid}/study_group_memberships`,
          setStudyGroupMemberships
        )
      );
      unsubs.push(
        subscribeCol<OnlineAssessment>(
          query(collection(db, 'online_assessments'), where('status', 'in', ['published', 'closed'])),
          'online_assessments',
          setOnlineAssessments
        )
      );
      unsubs.push(subscribeCol<CourseAssignment>(collection(db, 'course_assignments'), 'course_assignments', setCourseAssignments));
      unsubs.push(
        subscribeCol<StudentNotification>(
          query(collection(db, 'student_notifications'), where('targetScope', '==', 'course')),
          'student_notifications',
          setCourseNotifications
        )
      );
      unsubs.push(
        subscribeCol<NotificationRead>(
          collection(db, 'users', uid, 'notification_reads'),
          `users/${uid}/notification_reads`,
          setNotificationReads
        )
      );

      if (boundStudentId) {
        unsubs.push(
          subscribeCol<ExamMark>(
            query(
              collection(db, 'exam_marks'),
              where('studentId', '==', boundStudentId),
              where('workflowStatus', '==', 'published')
            ),
            'exam_marks',
            setExamMarks
          )
        );
        unsubs.push(
          subscribeCol<AssessmentSubmission>(
            query(collection(db, 'assessment_submissions'), where('studentId', '==', boundStudentId)),
            'assessment_submissions',
            setAssessmentSubmissions
          )
        );
        unsubs.push(
          subscribeCol<AssignmentSubmission>(
            query(collection(db, 'assignment_submissions'), where('studentId', '==', boundStudentId)),
            'assignment_submissions',
            setAssignmentSubmissions
          )
        );
        unsubs.push(
          subscribeCol<StudentNotification>(
            query(collection(db, 'student_notifications'), where('targetStudentId', '==', boundStudentId)),
            'student_notifications',
            setPersonalNotifications
          )
        );
      } else {
        unsubs.push(
          subscribeCol<ExamMark>(
            query(
              collection(db, 'exam_marks'),
              where('studentUid', '==', uid),
              where('workflowStatus', '==', 'published')
            ),
            'exam_marks',
            setExamMarks
          )
        );
        unsubs.push(
          subscribeCol<AssessmentSubmission>(
            query(collection(db, 'assessment_submissions'), where('studentUid', '==', uid)),
            'assessment_submissions',
            setAssessmentSubmissions
          )
        );
        unsubs.push(
          subscribeCol<AssignmentSubmission>(
            query(collection(db, 'assignment_submissions'), where('studentUid', '==', uid)),
            'assignment_submissions',
            setAssignmentSubmissions
          )
        );
        unsubs.push(
          subscribeCol<StudentNotification>(
            query(collection(db, 'student_notifications'), where('targetStudentUid', '==', uid)),
            'student_notifications',
            setPersonalNotifications
          )
        );
      }
    } else {
      setAttendanceSessions([]);
      setExamMarks([]);
      setCourseResources([]);
      setOnlineClasses([]);
      setOnlineAssessments([]);
      setAssessmentSubmissions([]);
      setCourseAssignments([]);
      setAssignmentSubmissions([]);
      setCourseNotifications([]);
      setPersonalNotifications([]);
      setNotificationReads([]);
      setStudyGroups([]);
      setStudyGroupMemberships([]);
    }

    if (isFin || isAdm) {
      unsubs.push(subscribeCol<StudentAccount>(collection(db, 'student_accounts'), 'student_accounts', setStudentAccounts));
    } else if (actualRole === 'student') {
      if (boundStudentId) {
        unsubs.push(subscribeSingleDoc<StudentAccount>('student_accounts', boundStudentId, setStudentAccounts));
      } else {
        unsubs.push(
          subscribeCol<StudentAccount>(
            query(collection(db, 'student_accounts'), where('studentUid', '==', uid)),
            'student_accounts',
            setStudentAccounts
          )
        );
      }
    } else {
      setStudentAccounts([]);
    }

    if (isFin) {
      unsubs.push(subscribeCol<PaymentSubmission>(collection(db, 'payment_submissions'), 'payment_submissions', setPayments));
      unsubs.push(subscribeCol<Receipt>(collection(db, 'receipts'), 'receipts', setReceipts));
      unsubs.push(subscribeCol<ScholarshipAward>(collection(db, 'scholarships'), 'scholarships', setScholarships));
    } else if (actualRole === 'student') {
      setScholarships([]);
      if (boundStudentId) {
        unsubs.push(
          subscribeCol<PaymentSubmission>(
            query(collection(db, 'payment_submissions'), where('studentId', '==', boundStudentId)),
            'payment_submissions',
            setPayments
          )
        );
        unsubs.push(
          subscribeCol<Receipt>(
            query(collection(db, 'receipts'), where('studentId', '==', boundStudentId)),
            'receipts',
            setReceipts
          )
        );
      } else {
        unsubs.push(
          subscribeCol<PaymentSubmission>(
            query(collection(db, 'payment_submissions'), where('studentUid', '==', uid)),
            'payment_submissions',
            setPayments
          )
        );
        unsubs.push(
          subscribeCol<Receipt>(
            query(collection(db, 'receipts'), where('studentUid', '==', uid)),
            'receipts',
            setReceipts
          )
        );
      }
    } else {
      setPayments([]);
      setReceipts([]);
      setScholarships([]);
    }

    if (isHr || isFin) {
      unsubs.push(subscribeCol<Employee>(collection(db, 'employees'), 'employees', setEmployees));
    } else if (isStaff) {
      if (boundEmployeeId) {
        unsubs.push(subscribeSingleDoc<Employee>('employees', boundEmployeeId, setEmployees));
      } else {
        unsubs.push(
          subscribeCol<Employee>(query(collection(db, 'employees'), where('uid', '==', uid)), 'employees', setEmployees)
        );
      }
    } else {
      setEmployees([]);
    }

    if (isHr) {
      unsubs.push(subscribeCol<LeaveRequest>(collection(db, 'leave_requests'), 'leave_requests', setLeaveRequests));
    } else if (isStaff) {
      unsubs.push(
        subscribeCol<LeaveRequest>(
          query(collection(db, 'leave_requests'), where('employeeUid', '==', uid)),
          'leave_requests',
          setLeaveRequests
        )
      );
    } else {
      setLeaveRequests([]);
    }

    if (isHr || isFin || isMgmt) {
      unsubs.push(subscribeCol<PayrollRun>(collection(db, 'payroll_runs'), 'payroll_runs', setPayrollRuns));
      unsubs.push(subscribeCol<AuditLog>(collection(db, 'audit_logs'), 'audit_logs', setAuditLogs));
    } else {
      setPayrollRuns([]);
      setAuditLogs([]);
    }

    if (isAdm || isFin) {
      unsubs.push(subscribeCol<SupportTicket>(collection(db, 'support_tickets'), 'support_tickets', setTickets));
    } else {
      unsubs.push(
        subscribeCol<SupportTicket>(
          query(collection(db, 'support_tickets'), where('requesterUid', '==', uid)),
          'support_tickets',
          setTickets
        )
      );
    }

    return () => unsubs.forEach((u) => u());
  }, [authReady, uid, firebaseUser, actualRole, boundStudentId, boundEmployeeId]);

  return {
    loading,
    faculties,
    departments,
    programmes,
    courses,
    calendars,
    statutoryConfigs,
    applications,
    students,
    registrations,
    attendanceSessions,
    examMarks,
    courseResources,
    onlineClasses,
    onlineAssessments,
    assessmentSubmissions,
    courseAssignments,
    assignmentSubmissions,
    studentNotifications: Array.from(
      new Map([...courseNotifications, ...personalNotifications].map((n) => [n.id, n])).values()
    ).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    notificationReadIds: notificationReads.map((r) => r.notifId),
    studyGroups,
    joinedStudyGroupIds: studyGroupMemberships.map((m) => m.groupId),
    feeStructures,
    studentAccounts,
    payments,
    receipts,
    scholarships,
    employees,
    leaveRequests,
    payrollRuns,
    notices,
    tickets,
    auditLogs,
    users,
    roleInvites,
  };
}
