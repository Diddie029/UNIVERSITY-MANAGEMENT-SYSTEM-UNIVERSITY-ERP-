export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'management'
  | 'admissions'
  | 'lecturer'
  | 'hod'
  | 'exam_officer'
  | 'finance'
  | 'hr'
  | 'student'
  | 'applicant';

export type ErpSection =
  | 'dashboard'
  | 'admissions'
  | 'students'
  | 'academics'
  | 'resources'
  | 'finance'
  | 'hr'
  | 'governance'
  | 'services';

export interface UserProfile {
  id: string;
  uid: string;
  displayName: string;
  role: UserRole;
  departmentId?: string;
  programmeId?: string;
  studentId?: string;
  employeeId?: string;
  inviteId?: string;
  bindingId?: string;
  status: 'active' | 'suspended';
  accountActivated?: boolean;
  lastActiveAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleInvite {
  id: string;
  email: string;
  role: Exclude<UserRole, 'applicant'>;
  departmentId?: string;
  assignedBy: string;
  createdAt: string;
}

export interface Faculty {
  id: string;
  code: string;
  name: string;
  deanName?: string;
  createdAt: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  facultyId: string;
  hodName?: string;
  createdAt: string;
}

export interface Programme {
  id: string;
  code: string;
  name: string;
  level: 'Degree' | 'Diploma' | 'Masters' | 'PhD';
  departmentId: string;
  durationYears: number;
  minKcseGrade?: string;
  createdAt: string;
}

export interface Course {
  id: string;
  code: string;
  title: string;
  programmeId: string;
  departmentId: string;
  yearLevel: number;
  semesterNumber: number;
  creditUnits: number;
  prerequisiteCode?: string;
  lecturerUid?: string;
  lecturerEmployeeId?: string;
  lecturerStaffNo?: string;
  lecturerName?: string;
  schedule?: string;
  room?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AcademicCalendar {
  id: string;
  academicYear: string;
  semesterName: string;
  isActive: boolean;
  registrationOpen: boolean;
  marksEntryOpen: boolean;
  startDate?: string;
  endDate?: string;
  updatedAt: string;
}

export interface PayeBand {
  upTo: number | null;
  rate: number;
  label: string;
}

export interface GradingRule {
  grade: string;
  minScore: number;
  maxScore: number;
  points: number;
  remark: string;
}

export interface StatutoryConfig {
  id: string;
  shifRate: number;
  housingLevyRate: number;
  nssfTier1Limit: number;
  nssfTier2Limit: number;
  nssfRate: number;
  personalRelief: number;
  payeBandsJson: string;
  gradingScaleJson: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface AdmissionApplication {
  id: string;
  applicantUid: string;
  fullName: string;
  email: string;
  phone: string;
  nationalId: string;
  kcseIndex?: string;
  kcseMeanGrade: string;
  programmeId: string;
  programmeName?: string;
  entryCategory: 'KUCCPS' | 'Self-Sponsored';
  intake?: string;
  appFeePaybillRef: string;
  status: 'submitted' | 'under_review' | 'admitted' | 'rejected';
  generatedAdmissionNo?: string;
  reviewNotes?: string;
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  uid?: string;
  admissionNo: string;
  fullName: string;
  email?: string;
  phone?: string;
  nationalId?: string;
  programmeId: string;
  programmeName?: string;
  departmentId?: string;
  facultyId?: string;
  yearOfStudy: number;
  semester: number;
  category: 'KUCCPS' | 'Self-Sponsored';
  academicStatus: 'Active' | 'Academic Leave' | 'Deferred' | 'Graduated' | 'Discontinued';
  clearanceFinance?: boolean;
  clearanceLibrary?: boolean;
  clearanceDepartment?: boolean;
  clearanceExams?: boolean;
  accountActivated?: boolean;
  activatedAt?: string;
  bulkImported?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CourseRegistration {
  id: string;
  studentId: string;
  studentUid?: string;
  admissionNo: string;
  studentName: string;
  academicYear: string;
  semesterName: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  creditUnits: number;
  status: 'registered' | 'dropped';
  createdAt: string;
}

export interface AttendanceSession {
  id: string;
  courseId: string;
  courseCode: string;
  lecturerUid: string;
  sessionDate: string;
  topic: string;
  presentCount: number;
  totalEnrolled: number;
  presentStudentIds?: string[];
  createdAt: string;
}

export interface ExamMark {
  id: string;
  studentId: string;
  studentUid?: string;
  admissionNo: string;
  studentName: string;
  courseId: string;
  courseCode: string;
  courseTitle?: string;
  creditUnits?: number;
  academicYear: string;
  semesterName: string;
  catScore: number;
  examScore: number;
  totalScore: number;
  grade: string;
  gradePoints?: number;
  workflowStatus: 'draft' | 'submitted' | 'moderated' | 'approved' | 'published';
  updatedBy?: string;
  updatedAt: string;
}

export interface FeeStructure {
  id: string;
  programmeId: string;
  programmeName: string;
  academicYear: string;
  semesterName: string;
  category: 'KUCCPS' | 'Self-Sponsored';
  tuitionFee: number;
  examFee?: number;
  libraryMedicalFee?: number;
  activityIctFee?: number;
  totalFee: number;
  updatedAt: string;
}

export interface StudentAccount {
  id: string;
  studentId: string;
  studentUid?: string;
  admissionNo: string;
  studentName: string;
  totalBilled: number;
  totalPaid: number;
  scholarshipsTotal: number;
  balance: number;
  cleared: boolean;
  updatedAt: string;
}

export interface PaymentSubmission {
  id: string;
  studentId: string;
  studentUid?: string;
  admissionNo: string;
  studentName: string;
  channel: 'M-PESA Paybill' | 'Bank Deposit' | 'EFT Transfer' | 'HELB Disbursement';
  referenceCode: string;
  payerPhoneOrBank?: string;
  amount: number;
  paymentDate: string;
  status: 'pending_verification' | 'verified' | 'rejected';
  verifiedBy?: string;
  rejectionReason?: string;
  receiptNumber?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Receipt {
  id: string;
  receiptNumber: string;
  paymentId: string;
  studentId: string;
  studentUid?: string;
  admissionNo: string;
  studentName: string;
  channel: string;
  referenceCode: string;
  amount: number;
  issuedBy: string;
  issuedAt: string;
}

export interface ScholarshipAward {
  id: string;
  studentId: string;
  admissionNo: string;
  studentName: string;
  awardType: 'HELB' | 'County Bursary' | 'Merit Scholarship' | 'CDF Bursary';
  referenceNo: string;
  amount: number;
  academicYear: string;
  awardedBy: string;
  createdAt: string;
}

export interface Employee {
  id: string;
  staffNo: string;
  uid?: string;
  fullName: string;
  email: string;
  departmentId: string;
  departmentName?: string;
  jobTitle: string;
  employmentCategory: 'Permanent' | 'Contract' | 'Part-Time' | 'Temporary';
  basicSalary: number;
  houseAllowance?: number;
  commuterAllowance?: number;
  pensionContribution?: number;
  kraPin?: string;
  bankName?: string;
  bankAccountMasked?: string;
  status: 'Active' | 'On Leave' | 'Terminated';
  createdAt: string;
  updatedAt: string;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeUid?: string;
  staffNo: string;
  employeeName: string;
  leaveType: 'Annual' | 'Sick' | 'Maternity/Paternity' | 'Study' | 'Compassionate';
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRun {
  id: string;
  monthLabel: string;
  employeeCount: number;
  totalGross: number;
  totalPaye: number;
  totalNssf: number;
  totalShif: number;
  totalHousingLevy: number;
  totalNetPay: number;
  status: 'draft' | 'approved' | 'paid';
  preparedBy: string;
  approvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Payslip {
  id: string;
  runId: string;
  monthLabel: string;
  employeeId: string;
  employeeUid?: string;
  staffNo: string;
  employeeName: string;
  jobTitle?: string;
  basicSalary: number;
  allowances?: number;
  grossPay: number;
  nssf: number;
  shif: number;
  housingLevy: number;
  pension?: number;
  taxablePay?: number;
  paye: number;
  netPay: number;
  bankName?: string;
  bankAccountMasked?: string;
  createdAt: string;
}

export type NoticeCategory =
  | 'Admission Intake'
  | 'Academic Circular'
  | 'Campus Event'
  | 'Fee & Finance'
  | 'Scholarship / Advert';

export interface Notice {
  id: string;
  title: string;
  body: string;
  category?: NoticeCategory;
  audience: 'All' | 'Students' | 'Staff';
  pinned?: boolean;
  eventDate?: string;
  ctaLabel?: string;
  authorName: string;
  createdAt: string;
}

export interface PortalBinding {
  id: string;
  code: string;
  targetType: 'student' | 'employee';
  targetId: string;
  role: Exclude<UserRole, 'super_admin' | 'applicant'>;
  fullName: string;
  verificationHash: string;
  boundUid?: string;
  activated?: boolean;
  activatedAt?: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  requesterUid: string;
  requesterName: string;
  category: 'Academic' | 'Finance' | 'Admissions' | 'ICT' | 'Welfare';
  subject: string;
  description: string;
  status: 'open' | 'in_progress' | 'resolved';
  resolutionNote?: string;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorName: string;
  actorRole: string;
  action: string;
  entityPath: string;
  details: string;
  previousRole?: string;
  newRole?: string;
  targetUid?: string;
  targetName?: string;
  reason?: string;
  createdAt: string;
}

export type ResourceType =
  | 'Textbook / E-Book'
  | 'Lecture Notes'
  | 'Past Paper'
  | 'Lab Manual'
  | 'Video Lecture';

export interface CourseResource {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  resourceType: ResourceType;
  authorOrEdition?: string;
  summary?: string;
  contentBody?: string;
  resourceUrl?: string;
  fileName?: string;
  fileDataUrl?: string;
  uploadedByUid: string;
  uploadedByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineClass {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  topicSummary?: string;
  platform: 'EDUVANCE Virtual Room' | 'PUST Virtual Room' | 'Google Meet' | 'Zoom' | 'Microsoft Teams';
  meetingUrl?: string;
  passcode?: string;
  scheduledStart: string;
  durationMinutes: number;
  status: 'scheduled' | 'live' | 'completed';
  lecturerUid: string;
  lecturerName: string;
  qrToken?: string;
  qrExpiresAt?: string;
  qrCreatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OnlineClassAttendance {
  id: string;
  classId: string;
  courseId: string;
  courseCode: string;
  studentUid: string;
  studentId?: string;
  admissionNo?: string;
  displayName: string;
  tokenUsed: string;
  method: 'qr_scan' | 'manual_checkin';
  checkedInAt: string;
}

export interface ExamTimetableEntry {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  examType: 'End-of-Semester Exam' | 'CAT' | 'Practical Exam' | 'Online Exam';
  examDate: string;
  startTime: string;
  durationMinutes: number;
  venue: string;
  invigilator?: string;
  instructions?: string;
  academicYear: string;
  semesterName: string;
  status: 'scheduled' | 'postponed' | 'completed';
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassMessage {
  id: string;
  classId: string;
  senderUid: string;
  senderName: string;
  senderRole: 'lecturer' | 'student';
  kind: 'chat' | 'checkin';
  body: string;
  createdAt: string;
}

export interface AssessmentQuestion {
  id: string;
  prompt: string;
  kind: 'mcq' | 'short_answer';
  options?: string[];
  correctOptionIndex?: number;
  marks: number;
}

export interface OnlineAssessment {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  assessmentType: 'Online CAT' | 'Online Exam';
  title: string;
  instructions?: string;
  durationMinutes: number;
  dueDate: string;
  totalMarks: number;
  status: 'draft' | 'published' | 'closed';
  questions: AssessmentQuestion[];
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentAnswer {
  questionId: string;
  answerText: string;
  selectedOptionIndex?: number;
}

export interface AssessmentSubmission {
  id: string;
  assessmentId: string;
  assessmentTitle: string;
  assessmentType: 'Online CAT' | 'Online Exam';
  courseId: string;
  courseCode: string;
  studentId: string;
  studentUid: string;
  admissionNo: string;
  studentName: string;
  answers: AssessmentAnswer[];
  autoScore: number;
  totalScore: number;
  maxMarks: number;
  status: 'submitted' | 'graded';
  feedback?: string;
  gradedBy?: string;
  submittedAt: string;
  updatedAt: string;
}

export interface CourseAssignment {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  title: string;
  instructions: string;
  dueDate: string;
  maxMarks: number;
  status: 'open' | 'closed';
  resourceUrl?: string;
  fileName?: string;
  fileDataUrl?: string;
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  courseCode: string;
  studentId: string;
  studentUid: string;
  admissionNo: string;
  studentName: string;
  submissionText: string;
  submissionUrl?: string;
  fileName?: string;
  fileDataUrl?: string;
  score?: number;
  maxMarks?: number;
  status: 'submitted' | 'graded';
  feedback?: string;
  gradedBy?: string;
  submittedAt: string;
  updatedAt: string;
}

export interface StudentNotification {
  id: string;
  targetScope: 'course' | 'student';
  targetStudentId?: string;
  targetStudentUid?: string;
  courseId: string;
  courseCode: string;
  courseTitle?: string;
  category: 'grade' | 'assignment' | 'assessment';
  title: string;
  message: string;
  sourceCollection: 'course_assignments' | 'assignment_submissions' | 'online_assessments' | 'assessment_submissions';
  sourceId: string;
  isRead: boolean;
  createdByUid: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationRead {
  id: string;
  uid: string;
  notifId: string;
  readAt: string;
}

export interface StudyGroup {
  id: string;
  courseId: string;
  courseCode: string;
  courseTitle: string;
  name: string;
  topic: string;
  scheduleNote?: string;
  meetingUrl?: string;
  sharedNotes?: string;
  sharedNotesUpdatedBy?: string;
  status: 'active' | 'archived';
  maxMembers: number;
  memberCount: number;
  creatorUid: string;
  creatorName: string;
  creatorAdmissionNo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudyGroupMember {
  id: string;
  groupId: string;
  uid: string;
  studentId?: string;
  admissionNo?: string;
  displayName: string;
  role: 'host' | 'member';
  joinedAt: string;
}

export interface StudyGroupMessage {
  id: string;
  groupId: string;
  senderUid: string;
  senderName: string;
  senderAdmissionNo?: string;
  kind: 'chat' | 'resource_share' | 'system';
  body: string;
  createdAt: string;
}

export interface StudyGroupMembershipIndex {
  id: string;
  uid: string;
  groupId: string;
  role: 'host' | 'member';
  joinedAt: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Super Administrator',
  admin: 'Admin',
  management: 'University Management',
  admissions: 'Admissions Officer',
  lecturer: 'Lecturer',
  hod: 'Head of Department',
  exam_officer: 'Examinations Officer',
  finance: 'Finance Officer',
  hr: 'HR & Payroll Officer',
  student: 'Student',
  applicant: 'Prospective Applicant',
};

export const ROLE_NAV_SECTIONS: Record<UserRole, ErpSection[]> = {
  super_admin: ['dashboard', 'admissions', 'students', 'academics', 'resources', 'finance', 'hr', 'governance', 'services'],
  admin: ['dashboard', 'admissions', 'students', 'academics', 'resources', 'finance', 'hr', 'governance', 'services'],
  management: ['dashboard', 'admissions', 'students', 'academics', 'resources', 'finance', 'hr', 'governance', 'services'],
  admissions: ['dashboard', 'admissions', 'students', 'services'],
  lecturer: ['dashboard', 'academics', 'resources', 'services'],
  hod: ['dashboard', 'students', 'academics', 'resources', 'services'],
  exam_officer: ['dashboard', 'students', 'academics', 'resources', 'services'],
  finance: ['dashboard', 'finance', 'students', 'services'],
  hr: ['dashboard', 'hr', 'services'],
  student: ['dashboard', 'students', 'academics', 'resources', 'finance', 'services'],
  applicant: ['dashboard', 'admissions', 'services'],
};
