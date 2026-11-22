import {
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { clampStr, db, handleFirestoreError, hashVerificationKey, makeId, OperationType, sanitizeId } from './firebase';
import {
  calculateEmployeePayslip,
  evaluateKenyanGrade,
  generateAdmissionNumber,
  generateReceiptNumber,
} from './kenyaEngine';
import {
  AdmissionApplication,
  Employee,
  ExamMark,
  FeeStructure,
  GradingRule,
  PaymentSubmission,
  StatutoryConfig,
  Student,
  StudentAccount,
  UserRole,
} from '../types/erp';

export interface ActorContext {
  uid: string;
  name: string;
  role: UserRole;
}

export async function recordAuditLog(
  actor: ActorContext,
  action: string,
  entityPath: string,
  details: string
) {
  const id = makeId('aud');
  try {
    await setDoc(doc(db, 'audit_logs', id), {
      actorUid: actor.uid,
      actorName: clampStr(actor.name, 160) || 'System User',
      actorRole: clampStr(actor.role, 40),
      action: clampStr(action, 120),
      entityPath: clampStr(entityPath, 240),
      details: clampStr(details, 1000),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `audit_logs/${id}`);
  }
}

export async function verifyAndPostPayment(
  payment: PaymentSubmission,
  account: StudentAccount | undefined,
  actor: ActorContext
): Promise<string> {
  if (payment.status !== 'pending_verification') {
    throw new Error('Only pending payments can be verified.');
  }

  const now = new Date().toISOString();
  const receiptNumber = generateReceiptNumber();
  const receiptId = makeId('rct');
  const auditId = makeId('aud');
  const batch = writeBatch(db);

  batch.update(doc(db, 'payment_submissions', payment.id), {
    status: 'verified',
    verifiedBy: clampStr(actor.name, 128),
    receiptNumber,
    rejectionReason: '',
    updatedAt: now,
  });

  const currentPaid = Number(account?.totalPaid ?? 0);
  const currentBilled = Number(account?.totalBilled ?? 0);
  const currentScholarships = Number(account?.scholarshipsTotal ?? 0);
  const nextPaid = Math.round((currentPaid + Number(payment.amount)) * 100) / 100;
  const nextBalance = Math.round((currentBilled - nextPaid - currentScholarships) * 100) / 100;
  const cleared = nextBalance <= 0;

  if (account) {
    batch.update(doc(db, 'student_accounts', payment.studentId), {
      totalPaid: nextPaid,
      balance: nextBalance,
      cleared,
      updatedAt: now,
    });
  } else {
    batch.set(doc(db, 'student_accounts', payment.studentId), {
      studentId: payment.studentId,
      studentUid: payment.studentUid || '',
      admissionNo: payment.admissionNo,
      studentName: payment.studentName,
      totalBilled: 0,
      totalPaid: nextPaid,
      scholarshipsTotal: 0,
      balance: -nextPaid,
      cleared: true,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'receipts', receiptId), {
    receiptNumber,
    paymentId: payment.id,
    studentId: payment.studentId,
    studentUid: payment.studentUid || '',
    admissionNo: payment.admissionNo,
    studentName: payment.studentName,
    channel: payment.channel,
    referenceCode: payment.referenceCode,
    amount: Number(payment.amount),
    issuedBy: clampStr(actor.name, 128),
    issuedAt: now,
  });

  if (cleared) {
    batch.update(doc(db, 'students', payment.studentId), {
      clearanceFinance: true,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: 'PAYMENT_VERIFIED_AND_POSTED',
    entityPath: `payment_submissions/${payment.id}`,
    details: `Verified ${payment.channel} ref ${payment.referenceCode} (KES ${payment.amount}) for ${payment.admissionNo}. Issued ${receiptNumber}.`,
    createdAt: now,
  });

  try {
    await batch.commit();
    return receiptNumber;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `payment_submissions/${payment.id}`);
  }
}

export async function rejectPaymentSubmission(
  payment: PaymentSubmission,
  reason: string,
  actor: ActorContext
) {
  if (payment.status !== 'pending_verification') {
    throw new Error('Only pending payments can be rejected.');
  }
  const cleanReason = clampStr(reason, 300);
  if (cleanReason.length < 4) {
    throw new Error('Provide a valid rejection reason (at least 4 characters).');
  }

  const now = new Date().toISOString();
  const auditId = makeId('aud');
  const batch = writeBatch(db);

  batch.update(doc(db, 'payment_submissions', payment.id), {
    status: 'rejected',
    verifiedBy: clampStr(actor.name, 128),
    rejectionReason: cleanReason,
    updatedAt: now,
  });

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: 'PAYMENT_REJECTED',
    entityPath: `payment_submissions/${payment.id}`,
    details: `Rejected ${payment.channel} ref ${payment.referenceCode} (KES ${payment.amount}) for ${payment.admissionNo}: ${cleanReason}`,
    createdAt: now,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payment_submissions/${payment.id}`);
  }
}

export async function approveAdmissionApplication(
  app: AdmissionApplication,
  progCode: string,
  departmentId: string,
  facultyId: string,
  feeStructures: FeeStructure[],
  existingStudentsCount: number,
  actor: ActorContext
): Promise<string> {
  const now = new Date().toISOString();
  const admissionNo = generateAdmissionNumber(progCode, existingStudentsCount + 1);
  const studentId = makeId('stu');
  const auditId = makeId('aud');

  const matchingFee = feeStructures.find(
    (f) => f.programmeId === app.programmeId && f.category === app.entryCategory
  );
  const initialFee = matchingFee ? Number(matchingFee.totalFee) : app.entryCategory === 'KUCCPS' ? 28500 : 68000;

  const batch = writeBatch(db);

  batch.update(doc(db, 'applications', app.id), {
    status: 'admitted',
    generatedAdmissionNo: admissionNo,
    reviewedBy: clampStr(actor.name, 128),
    reviewNotes: 'Approved by Senate Admissions Committee',
    updatedAt: now,
  });

  batch.set(doc(db, 'students', studentId), {
    uid: app.applicantUid,
    admissionNo,
    fullName: app.fullName,
    email: app.email,
    phone: app.phone,
    nationalId: app.nationalId,
    programmeId: app.programmeId,
    programmeName: app.programmeName || progCode,
    departmentId,
    facultyId,
    yearOfStudy: 1,
    semester: 1,
    category: app.entryCategory,
    academicStatus: 'Active',
    clearanceFinance: false,
    clearanceLibrary: false,
    clearanceDepartment: false,
    clearanceExams: false,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(doc(db, 'student_accounts', studentId), {
    studentId,
    studentUid: app.applicantUid,
    admissionNo,
    studentName: app.fullName,
    totalBilled: initialFee,
    totalPaid: 0,
    scholarshipsTotal: 0,
    balance: initialFee,
    cleared: initialFee <= 0,
    updatedAt: now,
  });

  const verificationHash = await hashVerificationKey(app.nationalId);
  batch.set(doc(db, 'portal_bindings', sanitizeId(admissionNo.toUpperCase())), {
    code: admissionNo.toUpperCase(),
    targetType: 'student',
    targetId: studentId,
    role: 'student',
    fullName: app.fullName,
    verificationHash,
    boundUid: app.applicantUid || '',
    createdAt: now,
  });

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: 'ADMISSION_APPROVED',
    entityPath: `applications/${app.id}`,
    details: `Admitted ${app.fullName} into ${app.programmeName || progCode} with Admission No ${admissionNo} and billed KES ${initialFee}.`,
    createdAt: now,
  });

  try {
    await batch.commit();
    return admissionNo;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `applications/${app.id}`);
  }
}

export async function postScholarshipToStudent(
  student: Student,
  account: StudentAccount | undefined,
  awardType: 'HELB' | 'County Bursary' | 'Merit Scholarship' | 'CDF Bursary',
  referenceNo: string,
  amount: number,
  academicYear: string,
  actor: ActorContext
) {
  const now = new Date().toISOString();
  const awardId = makeId('sch');
  const auditId = makeId('aud');
  const batch = writeBatch(db);

  batch.set(doc(db, 'scholarships', awardId), {
    studentId: student.id,
    admissionNo: student.admissionNo,
    studentName: student.fullName,
    awardType,
    referenceNo: clampStr(referenceNo, 64),
    amount: Number(amount),
    academicYear: clampStr(academicYear, 32),
    awardedBy: clampStr(actor.name, 128),
    createdAt: now,
  });

  const currentPaid = Number(account?.totalPaid ?? 0);
  const currentBilled = Number(account?.totalBilled ?? 0);
  const currentSch = Number(account?.scholarshipsTotal ?? 0);
  const nextSch = Math.round((currentSch + Number(amount)) * 100) / 100;
  const nextBalance = Math.round((currentBilled - currentPaid - nextSch) * 100) / 100;

  if (account) {
    batch.update(doc(db, 'student_accounts', student.id), {
      scholarshipsTotal: nextSch,
      balance: nextBalance,
      cleared: nextBalance <= 0,
      updatedAt: now,
    });
  } else {
    batch.set(doc(db, 'student_accounts', student.id), {
      studentId: student.id,
      studentUid: student.uid || '',
      admissionNo: student.admissionNo,
      studentName: student.fullName,
      totalBilled: 0,
      totalPaid: 0,
      scholarshipsTotal: nextSch,
      balance: -nextSch,
      cleared: true,
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: 'SCHOLARSHIP_POSTED',
    entityPath: `scholarships/${awardId}`,
    details: `Credited ${awardType} (${referenceNo}) of KES ${amount} to ${student.admissionNo}.`,
    createdAt: now,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `scholarships/${awardId}`);
  }
}

export async function generateMonthlyPayrollRun(
  monthLabel: string,
  employees: Employee[],
  config: StatutoryConfig,
  actor: ActorContext
): Promise<string> {
  const activeEmployees = employees.filter((e) => e.status === 'Active');
  if (activeEmployees.length === 0) {
    throw new Error('No active employees found to run payroll.');
  }

  const now = new Date().toISOString();
  const runId = makeId('payrun');
  const auditId = makeId('aud');
  const slips = activeEmployees.map((emp) => calculateEmployeePayslip(emp, runId, monthLabel, config));

  const totals = slips.reduce(
    (acc, s) => ({
      gross: acc.gross + s.grossPay,
      paye: acc.paye + s.paye,
      nssf: acc.nssf + s.nssf,
      shif: acc.shif + s.shif,
      housing: acc.housing + s.housingLevy,
      net: acc.net + s.netPay,
    }),
    { gross: 0, paye: 0, nssf: 0, shif: 0, housing: 0, net: 0 }
  );

  const batch = writeBatch(db);
  batch.set(doc(db, 'payroll_runs', runId), {
    monthLabel: clampStr(monthLabel, 40),
    employeeCount: slips.length,
    totalGross: Math.round(totals.gross * 100) / 100,
    totalPaye: Math.round(totals.paye * 100) / 100,
    totalNssf: Math.round(totals.nssf * 100) / 100,
    totalShif: Math.round(totals.shif * 100) / 100,
    totalHousingLevy: Math.round(totals.housing * 100) / 100,
    totalNetPay: Math.round(totals.net * 100) / 100,
    status: 'draft',
    preparedBy: clampStr(actor.name, 128),
    approvedBy: '',
    createdAt: now,
    updatedAt: now,
  });

  for (const slip of slips) {
    const slipId = makeId('slip');
    batch.set(doc(db, 'payroll_runs', runId, 'payslips', slipId), slip);
  }

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: 'PAYROLL_RUN_GENERATED',
    entityPath: `payroll_runs/${runId}`,
    details: `Prepared ${monthLabel} payroll draft for ${slips.length} active staff (Gross KES ${Math.round(totals.gross)}, Net KES ${Math.round(totals.net)}).`,
    createdAt: now,
  });

  try {
    await batch.commit();
    return runId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `payroll_runs/${runId}`);
  }
}

export async function transitionPayrollRunStatus(
  runId: string,
  monthLabel: string,
  nextStatus: 'approved' | 'paid',
  actor: ActorContext
) {
  const now = new Date().toISOString();
  const auditId = makeId('aud');
  const batch = writeBatch(db);

  batch.update(doc(db, 'payroll_runs', runId), {
    status: nextStatus,
    approvedBy: clampStr(actor.name, 128),
    updatedAt: now,
  });

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: nextStatus === 'approved' ? 'PAYROLL_RUN_APPROVED' : 'PAYROLL_RUN_DISBURSED',
    entityPath: `payroll_runs/${runId}`,
    details: `Marked ${monthLabel} payroll batch as ${nextStatus.toUpperCase()}.`,
    createdAt: now,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `payroll_runs/${runId}`);
  }
}

export async function saveExamMarkWithAudit(
  existingMark: ExamMark | undefined,
  payload: {
    student: Student;
    courseId: string;
    courseCode: string;
    courseTitle: string;
    creditUnits: number;
    academicYear: string;
    semesterName: string;
    catScore: number;
    examScore: number;
    workflowStatus: ExamMark['workflowStatus'];
  },
  customScale: GradingRule[] | undefined,
  actor: ActorContext
) {
  const { totalScore, grade, gradePoints } = evaluateKenyanGrade(
    payload.catScore,
    payload.examScore,
    customScale
  );
  const now = new Date().toISOString();
  const markId = existingMark?.id ?? `${payload.student.id}_${payload.courseId}`;
  const auditId = makeId('aud');
  const batch = writeBatch(db);

  if (existingMark) {
    batch.update(doc(db, 'exam_marks', markId), {
      catScore: Number(payload.catScore),
      examScore: Number(payload.examScore),
      totalScore,
      grade,
      gradePoints,
      workflowStatus: payload.workflowStatus,
      updatedBy: clampStr(actor.name, 128),
      updatedAt: now,
    });
  } else {
    batch.set(doc(db, 'exam_marks', markId), {
      studentId: payload.student.id,
      studentUid: payload.student.uid || '',
      admissionNo: payload.student.admissionNo,
      studentName: payload.student.fullName,
      courseId: payload.courseId,
      courseCode: payload.courseCode,
      courseTitle: payload.courseTitle,
      creditUnits: payload.creditUnits,
      academicYear: payload.academicYear,
      semesterName: payload.semesterName,
      catScore: Number(payload.catScore),
      examScore: Number(payload.examScore),
      totalScore,
      grade,
      gradePoints,
      workflowStatus: payload.workflowStatus,
      updatedBy: clampStr(actor.name, 128),
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: 'EXAM_MARKS_UPDATED',
    entityPath: `exam_marks/${markId}`,
    details: `${payload.courseCode} for ${payload.student.admissionNo}: CAT ${payload.catScore} + Exam ${payload.examScore} = ${totalScore} (${grade}) [${payload.workflowStatus}].`,
    createdAt: now,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `exam_marks/${markId}`);
  }
}

export async function bulkTransitionCourseMarks(
  marks: ExamMark[],
  targetStatus: ExamMark['workflowStatus'],
  courseCode: string,
  actor: ActorContext
) {
  if (marks.length === 0) return;
  const now = new Date().toISOString();
  const auditId = makeId('aud');
  const batch = writeBatch(db);

  for (const m of marks) {
    batch.update(doc(db, 'exam_marks', m.id), {
      workflowStatus: targetStatus,
      updatedBy: clampStr(actor.name, 128),
      updatedAt: now,
    });
  }

  batch.set(doc(db, 'audit_logs', auditId), {
    actorUid: actor.uid,
    actorName: clampStr(actor.name, 160),
    actorRole: actor.role,
    action: `MARKS_WORKFLOW_${targetStatus.toUpperCase()}`,
    entityPath: `exam_marks/${courseCode}`,
    details: `Transitioned ${marks.length} student mark records in ${courseCode} to ${targetStatus}.`,
    createdAt: now,
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `exam_marks/${courseCode}`);
  }
}

export async function billSemesterFeesForCohort(
  students: Student[],
  accounts: StudentAccount[],
  feeStructures: FeeStructure[],
  academicYear: string,
  semesterName: string,
  actor: ActorContext
): Promise<number> {
  const activeStudents = students.filter((s) => s.academicStatus === 'Active');
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  let billedCount = 0;

  for (const stu of activeStudents) {
    const struct = feeStructures.find(
      (f) => f.programmeId === stu.programmeId && f.category === stu.category
    );
    if (!struct) continue;
    const acct = accounts.find((a) => a.studentId === stu.id);
    const feeAmount = Number(struct.totalFee);
    const nextBilled = Math.round((Number(acct?.totalBilled ?? 0) + feeAmount) * 100) / 100;
    const paid = Number(acct?.totalPaid ?? 0);
    const sch = Number(acct?.scholarshipsTotal ?? 0);
    const nextBal = Math.round((nextBilled - paid - sch) * 100) / 100;

    if (acct) {
      batch.update(doc(db, 'student_accounts', stu.id), {
        totalBilled: nextBilled,
        balance: nextBal,
        cleared: nextBal <= 0,
        updatedAt: now,
      });
    } else {
      batch.set(doc(db, 'student_accounts', stu.id), {
        studentId: stu.id,
        studentUid: stu.uid || '',
        admissionNo: stu.admissionNo,
        studentName: stu.fullName,
        totalBilled: nextBilled,
        totalPaid: 0,
        scholarshipsTotal: 0,
        balance: nextBal,
        cleared: nextBal <= 0,
        updatedAt: now,
      });
    }
    billedCount += 1;
  }

  if (billedCount > 0) {
    const auditId = makeId('aud');
    batch.set(doc(db, 'audit_logs', auditId), {
      actorUid: actor.uid,
      actorName: clampStr(actor.name, 160),
      actorRole: actor.role,
      action: 'SEMESTER_FEES_BILLED',
      entityPath: `student_accounts/batch`,
      details: `Posted ${academicYear} ${semesterName} fee invoices to ${billedCount} active student accounts.`,
      createdAt: now,
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'student_accounts/batch');
    }
  }
  return billedCount;
}

export async function linkStudentOrEmployeeUidOnSignIn(uid: string, email: string) {
  // Helper used when an admin updates user record or checks existing records
  try {
    const stuSnap = await getDocs(query(collection(db, 'students'), where('email', '==', email)));
    for (const d of stuSnap.docs) {
      if (!d.data().uid) {
        await updateDoc(doc(db, 'students', d.id), { uid, updatedAt: new Date().toISOString() });
      }
    }
  } catch {
    // Non-privileged accounts may not have list permission across all students; safe no-op
  }
}
