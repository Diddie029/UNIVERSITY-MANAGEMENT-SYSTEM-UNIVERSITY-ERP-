import { doc, getDoc, writeBatch } from 'firebase/firestore';
import { clampStr, db, handleFirestoreError, hashVerificationKey, makeId, OperationType, sanitizeId } from './firebase';
import { DEFAULT_STATUTORY_CONFIG } from './kenyaEngine';
import { ActorContext } from './erpService';

async function seedDocExists(collectionName: string, id: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(db, collectionName, id));
    return snap.exists();
  } catch {
    return false;
  }
}

export async function seedInstitutionalDatabase(actor: ActorContext): Promise<void> {
  const now = new Date().toISOString();
  const actorName = clampStr(actor.name || 'Super Administrator', 120) || 'Super Administrator';

  // Batch 1: Top-level independent catalogs (Faculties, Calendars, Statutory Config, Notices)
  const batch1 = writeBatch(db);
  const faculties = [
    { id: 'fac_sci', code: 'FSCI', name: 'School of Computing & Engineering Sciences', deanName: 'Prof. Fatuma Omar', createdAt: now },
    { id: 'fac_bus', code: 'FBUS', name: 'School of Business & Economics', deanName: 'Prof. David Kamau', createdAt: now },
    { id: 'fac_med', code: 'FMED', name: 'School of Health & Applied Sciences', deanName: 'Dr. Grace Muthoni', createdAt: now },
  ];
  for (const f of faculties) {
    const { id, ...data } = f;
    batch1.set(doc(db, 'faculties', id), data);
  }

  batch1.set(doc(db, 'academic_calendars', 'cal_2026_s1'), {
    academicYear: '2026/2027',
    semesterName: 'Semester I (Sept - Dec)',
    isActive: true,
    registrationOpen: true,
    marksEntryOpen: true,
    startDate: '2026-09-07',
    endDate: '2026-12-18',
    updatedAt: now,
  });

  batch1.set(doc(db, 'statutory_configs', 'kenya_default'), {
    ...DEFAULT_STATUTORY_CONFIG,
    updatedBy: actorName,
    updatedAt: now,
  });

  batch1.set(doc(db, 'notices', 'not_001'), {
    title: 'January 2027 Intake & KUCCPS / Self-Sponsored Admissions Open',
    body: 'Pwani University of Science & Technology invites qualified KCSE candidates (Mean Grade C+ and above for Degree, C- for Diploma) to apply online for Computer Science, Civil Engineering, and Commerce programmes.',
    category: 'Admission Intake',
    audience: 'All',
    pinned: true,
    eventDate: '2026-12-15',
    ctaLabel: 'Apply for Admission',
    authorName: 'Office of the Academic Registrar',
    createdAt: now,
  });

  batch1.set(doc(db, 'notices', 'not_002'), {
    title: '2026/2027 Semester I Fee Payment & Paybill 522522 Guidelines',
    body: 'Students remitting fees via M-PESA Paybill 522522 (Account: Admission Number) or KCB Bank deposit must submit their transaction reference code in the Finance portal for official reconciliation and receipt issuance.',
    category: 'Fee & Finance',
    audience: 'Students',
    pinned: false,
    eventDate: '2026-11-30',
    ctaLabel: 'Portal Sign In',
    authorName: 'Office of the Finance Officer',
    createdAt: now,
  });

  batch1.set(doc(db, 'notices', 'not_003'), {
    title: 'Vice-Chancellor STEM Merit Scholarship & County Bursary Window',
    body: 'Continuing First Class Honours and financially needy students are invited to submit HELB, NG-CDF, and County Bursary allocation letters at the Finance Office for ledger crediting.',
    category: 'Scholarship / Advert',
    audience: 'All',
    pinned: true,
    eventDate: '2026-12-10',
    ctaLabel: 'View Fee Schedule',
    authorName: 'Dean of Students & Financial Aid',
    createdAt: now,
  });

  batch1.set(doc(db, 'notices', 'not_004'), {
    title: 'PUST Coastal Innovation Week & Engineering Showcase 2026',
    body: 'Join faculty, industry partners, and engineering cohorts at the Mombasa Main Senate Complex for live robotics, civil infrastructure, and fintech demonstrations.',
    category: 'Campus Event',
    audience: 'All',
    pinned: false,
    eventDate: '2026-12-05',
    ctaLabel: '',
    authorName: 'School of Computing & Engineering',
    createdAt: now,
  });

  batch1.set(doc(db, 'notices', 'not_005'), {
    title: 'Semester I Continuous Assessment (CAT) Marks Submission Deadline',
    body: 'All lecturers are reminded to upload CAT (/30) and End-of-Semester (/70) scores for departmental HoD moderation before the Senate Examination Board sitting.',
    category: 'Academic Circular',
    audience: 'Staff',
    pinned: false,
    eventDate: '2026-12-08',
    ctaLabel: '',
    authorName: 'Academic Registrar (Examinations)',
    createdAt: now,
  });

  try {
    await batch1.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seedInstitutionalDatabase/batch1_faculties');
  }

  // Batch 2: Departments (depend on Faculties) + Employees + Leave Requests
  const batch2 = writeBatch(db);
  const departments = [
    { id: 'dep_cs', code: 'DCS', name: 'Department of Computer Science & Informatics', facultyId: 'fac_sci', hodName: 'Dr. Samuel Ochieng', createdAt: now },
    { id: 'dep_eng', code: 'DCE', name: 'Department of Civil & Structural Engineering', facultyId: 'fac_sci', hodName: 'Eng. Peter Njoroge', createdAt: now },
    { id: 'dep_fin', code: 'DBF', name: 'Department of Accounting & Finance', facultyId: 'fac_bus', hodName: 'Dr. Mercy Wanjiku', createdAt: now },
    { id: 'dep_nur', code: 'DNU', name: 'Department of Nursing & Public Health', facultyId: 'fac_med', hodName: 'Dr. Hassan Bakari', createdAt: now },
  ];
  for (const d of departments) {
    const { id, ...data } = d;
    batch2.set(doc(db, 'departments', id), data);
  }

  const employees = [
    {
      id: 'emp_001',
      staffNo: 'PUST-STF-0104',
      uid: '',
      fullName: 'Dr. Samuel Ochieng',
      email: 's.ochieng@pust.ac.ke',
      departmentId: 'dep_cs',
      departmentName: 'Department of Computer Science & Informatics',
      jobTitle: 'Senior Lecturer',
      employmentCategory: 'Permanent',
      basicSalary: 145000,
      houseAllowance: 35000,
      commuterAllowance: 14000,
      pensionContribution: 12000,
      kraPin: 'A004918231K',
      bankName: 'KCB Bank',
      bankAccountMasked: '****4421',
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'emp_002',
      staffNo: 'PUST-STF-0119',
      uid: '',
      fullName: 'Grace Njeri Waweru',
      email: 'g.waweru@pust.ac.ke',
      departmentId: 'dep_fin',
      departmentName: 'Department of Accounting & Finance',
      jobTitle: 'Senior Finance Accountant',
      employmentCategory: 'Permanent',
      basicSalary: 110000,
      houseAllowance: 25000,
      commuterAllowance: 10000,
      pensionContribution: 8500,
      kraPin: 'A008172645M',
      bankName: 'Equity Bank',
      bankAccountMasked: '****9012',
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'emp_003',
      staffNo: 'PUST-STF-0205',
      uid: '',
      fullName: 'Eng. Peter Njoroge',
      email: 'p.njoroge@pust.ac.ke',
      departmentId: 'dep_eng',
      departmentName: 'Department of Civil & Structural Engineering',
      jobTitle: 'Head of Department (Civil Eng)',
      employmentCategory: 'Contract',
      basicSalary: 168000,
      houseAllowance: 40000,
      commuterAllowance: 16000,
      pensionContribution: 14000,
      kraPin: 'A002391044P',
      bankName: 'Co-operative Bank',
      bankAccountMasked: '****1184',
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (const emp of employees) {
    const { id, ...data } = emp;
    batch2.set(doc(db, 'employees', id), data);
  }

  if (!(await seedDocExists('leave_requests', 'lev_001'))) {
    batch2.set(doc(db, 'leave_requests', 'lev_001'), {
      employeeId: 'emp_001',
      employeeUid: '',
      staffNo: 'PUST-STF-0104',
      employeeName: 'Dr. Samuel Ochieng',
      leaveType: 'Annual',
      startDate: '2026-12-14',
      endDate: '2026-12-23',
      days: 8,
      reason: 'End-of-semester academic recess annual leave.',
      status: 'pending',
      reviewedBy: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  try {
    await batch2.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seedInstitutionalDatabase/batch2_departments');
  }

  // Batch 3: Programmes (depend on Departments), Courses, Fee Structures
  const batch3 = writeBatch(db);
  const programmes = [
    { id: 'prog_bsccs', code: 'BSC-CS', name: 'BSc. Computer Science', level: 'Degree', departmentId: 'dep_cs', durationYears: 4, minKcseGrade: 'C+', createdAt: now },
    { id: 'prog_bscce', code: 'BENG-CE', name: 'BSc. Civil Engineering', level: 'Degree', departmentId: 'dep_eng', durationYears: 5, minKcseGrade: 'B-', createdAt: now },
    { id: 'prog_bcom', code: 'BCOM', name: 'Bachelor of Commerce (Finance)', level: 'Degree', departmentId: 'dep_fin', durationYears: 4, minKcseGrade: 'C+', createdAt: now },
    { id: 'prog_dipict', code: 'DIP-ICT', name: 'Diploma in Information Technology', level: 'Diploma', departmentId: 'dep_cs', durationYears: 2, minKcseGrade: 'C-', createdAt: now },
  ];
  for (const p of programmes) {
    const { id, ...data } = p;
    batch3.set(doc(db, 'programmes', id), data);
  }

  const courses = [
    { id: 'crs_csc201', code: 'CSC 201', title: 'Data Structures & Algorithms', programmeId: 'prog_bsccs', departmentId: 'dep_cs', yearLevel: 2, semesterNumber: 1, creditUnits: 3, prerequisiteCode: 'CSC 102', lecturerUid: actor.uid, lecturerName: 'Dr. Samuel Ochieng', schedule: 'Mon 08:00 - 11:00', room: 'TU-Lab 04', createdAt: now },
    { id: 'crs_csc204', code: 'CSC 204', title: 'Database Systems & SQL Design', programmeId: 'prog_bsccs', departmentId: 'dep_cs', yearLevel: 2, semesterNumber: 1, creditUnits: 3, prerequisiteCode: 'CSC 101', lecturerUid: actor.uid, lecturerName: 'Dr. Amina Salim', schedule: 'Wed 11:00 - 14:00', room: 'Block B-202', createdAt: now },
    { id: 'crs_csc301', code: 'CSC 301', title: 'Software Engineering & Cloud Systems', programmeId: 'prog_bsccs', departmentId: 'dep_cs', yearLevel: 3, semesterNumber: 1, creditUnits: 4, prerequisiteCode: 'CSC 201', lecturerUid: actor.uid, lecturerName: 'Dr. Samuel Ochieng', schedule: 'Thu 09:00 - 12:00', room: 'Innovation Hall 1', createdAt: now },
    { id: 'crs_bcom202', code: 'BCF 202', title: 'Corporate Finance & Capital Markets', programmeId: 'prog_bcom', departmentId: 'dep_fin', yearLevel: 2, semesterNumber: 1, creditUnits: 3, prerequisiteCode: 'BCF 101', lecturerUid: actor.uid, lecturerName: 'Dr. Mercy Wanjiku', schedule: 'Tue 14:00 - 17:00', room: 'Business Wing 105', createdAt: now },
    { id: 'crs_eng205', code: 'ECE 205', title: 'Structural Mechanics & Materials', programmeId: 'prog_bscce', departmentId: 'dep_eng', yearLevel: 2, semesterNumber: 1, creditUnits: 4, prerequisiteCode: 'ECE 104', lecturerUid: actor.uid, lecturerName: 'Eng. Peter Njoroge', schedule: 'Fri 08:00 - 11:00', room: 'Eng Studio 3', createdAt: now },
  ];
  for (const c of courses) {
    const { id, ...data } = c;
    batch3.set(doc(db, 'courses', id), data);
  }

  const fees = [
    { id: 'fee_cs_kuc', programmeId: 'prog_bsccs', programmeName: 'BSc. Computer Science', academicYear: '2026/2027', semesterName: 'Semester I (Sept - Dec)', category: 'KUCCPS', tuitionFee: 22000, examFee: 2500, libraryMedicalFee: 2500, activityIctFee: 1500, totalFee: 28500, updatedAt: now },
    { id: 'fee_cs_ssp', programmeId: 'prog_bsccs', programmeName: 'BSc. Computer Science', academicYear: '2026/2027', semesterName: 'Semester I (Sept - Dec)', category: 'Self-Sponsored', tuitionFee: 60000, examFee: 3000, libraryMedicalFee: 3000, activityIctFee: 2000, totalFee: 68000, updatedAt: now },
    { id: 'fee_bcom_kuc', programmeId: 'prog_bcom', programmeName: 'Bachelor of Commerce (Finance)', academicYear: '2026/2027', semesterName: 'Semester I (Sept - Dec)', category: 'KUCCPS', tuitionFee: 19500, examFee: 2000, libraryMedicalFee: 2500, activityIctFee: 1500, totalFee: 25500, updatedAt: now },
    { id: 'fee_ce_ssp', programmeId: 'prog_bscce', programmeName: 'BSc. Civil Engineering', academicYear: '2026/2027', semesterName: 'Semester I (Sept - Dec)', category: 'Self-Sponsored', tuitionFee: 72000, examFee: 3500, libraryMedicalFee: 3000, activityIctFee: 2500, totalFee: 81000, updatedAt: now },
  ];
  for (const fs of fees) {
    const { id, ...data } = fs;
    batch3.set(doc(db, 'fee_structures', id), data);
  }

  try {
    await batch3.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seedInstitutionalDatabase/batch3_programmes');
  }

  // Batch 4: Students, Student Accounts, Applications (depend on Programmes), and Portal Bindings
  const batch4 = writeBatch(db);
  const students = [
    {
      id: 'stu_001',
      uid: '',
      admissionNo: 'PUST/BSC-CS/2025/0042',
      fullName: 'Brian Kiprop Mutai',
      email: 'b.mutai@students.pust.ac.ke',
      phone: '+254712345601',
      nationalId: '38910422',
      programmeId: 'prog_bsccs',
      programmeName: 'BSc. Computer Science',
      departmentId: 'dep_cs',
      facultyId: 'fac_sci',
      yearOfStudy: 2,
      semester: 1,
      category: 'KUCCPS',
      academicStatus: 'Active',
      clearanceFinance: true,
      clearanceLibrary: true,
      clearanceDepartment: false,
      clearanceExams: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'stu_002',
      uid: '',
      admissionNo: 'PUST/BSC-CS/2025/0118',
      fullName: 'Aisha Mwajuma Hassan',
      email: 'a.hassan@students.pust.ac.ke',
      phone: '+254722891044',
      nationalId: '39451109',
      programmeId: 'prog_bsccs',
      programmeName: 'BSc. Computer Science',
      departmentId: 'dep_cs',
      facultyId: 'fac_sci',
      yearOfStudy: 2,
      semester: 1,
      category: 'Self-Sponsored',
      academicStatus: 'Active',
      clearanceFinance: false,
      clearanceLibrary: true,
      clearanceDepartment: true,
      clearanceExams: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'stu_003',
      uid: '',
      admissionNo: 'PUST/BCOM/2025/0075',
      fullName: 'Faith Wambui Karanja',
      email: 'f.karanja@students.pust.ac.ke',
      phone: '+254733612098',
      nationalId: '37890211',
      programmeId: 'prog_bcom',
      programmeName: 'Bachelor of Commerce (Finance)',
      departmentId: 'dep_fin',
      facultyId: 'fac_bus',
      yearOfStudy: 2,
      semester: 1,
      category: 'KUCCPS',
      academicStatus: 'Active',
      clearanceFinance: false,
      clearanceLibrary: false,
      clearanceDepartment: false,
      clearanceExams: false,
      createdAt: now,
      updatedAt: now,
    },
  ];
  for (const s of students) {
    const { id, ...data } = s;
    if (!(await seedDocExists('students', id))) {
      batch4.set(doc(db, 'students', id), data);
    }
  }

  const accounts = [
    { id: 'stu_001', studentId: 'stu_001', studentUid: '', admissionNo: 'PUST/BSC-CS/2025/0042', studentName: 'Brian Kiprop Mutai', totalBilled: 28500, totalPaid: 16500, scholarshipsTotal: 12000, balance: 0, cleared: true, updatedAt: now },
    { id: 'stu_002', studentId: 'stu_002', studentUid: '', admissionNo: 'PUST/BSC-CS/2025/0118', studentName: 'Aisha Mwajuma Hassan', totalBilled: 68000, totalPaid: 35000, scholarshipsTotal: 0, balance: 33000, cleared: false, updatedAt: now },
    { id: 'stu_003', studentId: 'stu_003', studentUid: '', admissionNo: 'PUST/BCOM/2025/0075', studentName: 'Faith Wambui Karanja', totalBilled: 25500, totalPaid: 10000, scholarshipsTotal: 8000, balance: 7500, cleared: false, updatedAt: now },
  ];
  for (const a of accounts) {
    const { id, ...data } = a;
    if (!(await seedDocExists('student_accounts', id))) {
      batch4.set(doc(db, 'student_accounts', id), data);
    }
  }

  if (!(await seedDocExists('applications', 'app_001'))) {
    batch4.set(doc(db, 'applications', 'app_001'), {
      applicantUid: actor.uid,
      fullName: 'Kelvin Mwenda Gitonga',
      email: 'k.gitonga@applicant.ke',
      phone: '+254700192837',
      nationalId: '40129384',
      kcseIndex: '20401002/044',
      kcseMeanGrade: 'B+',
      programmeId: 'prog_bsccs',
      programmeName: 'BSc. Computer Science',
      entryCategory: 'Self-Sponsored',
      intake: 'January 2027',
      appFeePaybillRef: 'UCB8X2P901',
      status: 'submitted',
      generatedAdmissionNo: '',
      reviewNotes: '',
      reviewedBy: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  const studentBindings = [
    { code: 'PUST/BSC-CS/2025/0042', targetId: 'stu_001', fullName: 'Brian Kiprop Mutai', secret: '38910422' },
    { code: 'PUST/BSC-CS/2025/0118', targetId: 'stu_002', fullName: 'Aisha Mwajuma Hassan', secret: '39451109' },
    { code: 'PUST/BCOM/2025/0075', targetId: 'stu_003', fullName: 'Faith Wambui Karanja', secret: '37890211' },
  ];
  for (const sb of studentBindings) {
    const bindingId = sanitizeId(sb.code.toUpperCase());
    if (!(await seedDocExists('portal_bindings', bindingId))) {
      const verificationHash = await hashVerificationKey(sb.secret);
      batch4.set(doc(db, 'portal_bindings', bindingId), {
        code: sb.code.toUpperCase(),
        targetType: 'student',
        targetId: sb.targetId,
        role: 'student',
        fullName: sb.fullName,
        verificationHash,
        boundUid: '',
        createdAt: now,
      });
    }
  }

  const staffBindings = [
    { code: 'PUST-STF-0104', targetId: 'emp_001', role: 'lecturer', fullName: 'Dr. Samuel Ochieng', secret: 'STF0104' },
    { code: 'PUST-STF-0119', targetId: 'emp_002', role: 'finance', fullName: 'Grace Njeri Waweru', secret: 'STF0119' },
    { code: 'PUST-STF-0205', targetId: 'emp_003', role: 'hod', fullName: 'Eng. Peter Njoroge', secret: 'STF0205' },
  ];
  for (const stf of staffBindings) {
    const bindingId = sanitizeId(stf.code.toUpperCase());
    if (!(await seedDocExists('portal_bindings', bindingId))) {
      const verificationHash = await hashVerificationKey(stf.secret);
      batch4.set(doc(db, 'portal_bindings', bindingId), {
        code: stf.code.toUpperCase(),
        targetType: 'employee',
        targetId: stf.targetId,
        role: stf.role,
        fullName: stf.fullName,
        verificationHash,
        boundUid: '',
        createdAt: now,
      });
    }
  }

  try {
    await batch4.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seedInstitutionalDatabase/batch4_students');
  }

  // Batch 5: Course Registrations, Exam Marks, Payment Submissions, Scholarships (depend on Students & Courses)
  const batch5 = writeBatch(db);
  batch5.set(doc(db, 'course_registrations', 'reg_001'), {
    studentId: 'stu_001',
    studentUid: '',
    admissionNo: 'PUST/BSC-CS/2025/0042',
    studentName: 'Brian Kiprop Mutai',
    academicYear: '2026/2027',
    semesterName: 'Semester I (Sept - Dec)',
    courseId: 'crs_csc201',
    courseCode: 'CSC 201',
    courseTitle: 'Data Structures & Algorithms',
    creditUnits: 3,
    status: 'registered',
    createdAt: now,
  });

  batch5.set(doc(db, 'course_registrations', 'reg_002'), {
    studentId: 'stu_002',
    studentUid: '',
    admissionNo: 'PUST/BSC-CS/2025/0118',
    studentName: 'Aisha Mwajuma Hassan',
    academicYear: '2026/2027',
    semesterName: 'Semester I (Sept - Dec)',
    courseId: 'crs_csc201',
    courseCode: 'CSC 201',
    courseTitle: 'Data Structures & Algorithms',
    creditUnits: 3,
    status: 'registered',
    createdAt: now,
  });

  batch5.set(doc(db, 'exam_marks', 'stu_001_crs_csc201'), {
    studentId: 'stu_001',
    studentUid: '',
    admissionNo: 'PUST/BSC-CS/2025/0042',
    studentName: 'Brian Kiprop Mutai',
    courseId: 'crs_csc201',
    courseCode: 'CSC 201',
    courseTitle: 'Data Structures & Algorithms',
    creditUnits: 3,
    academicYear: '2026/2027',
    semesterName: 'Semester I (Sept - Dec)',
    catScore: 25,
    examScore: 53,
    totalScore: 78,
    grade: 'A',
    gradePoints: 4.0,
    workflowStatus: 'published',
    updatedBy: actorName,
    updatedAt: now,
  });

  batch5.set(doc(db, 'exam_marks', 'stu_002_crs_csc201'), {
    studentId: 'stu_002',
    studentUid: '',
    admissionNo: 'PUST/BSC-CS/2025/0118',
    studentName: 'Aisha Mwajuma Hassan',
    courseId: 'crs_csc201',
    courseCode: 'CSC 201',
    courseTitle: 'Data Structures & Algorithms',
    creditUnits: 3,
    academicYear: '2026/2027',
    semesterName: 'Semester I (Sept - Dec)',
    catScore: 22,
    examScore: 44,
    totalScore: 66,
    grade: 'B',
    gradePoints: 3.0,
    workflowStatus: 'submitted',
    updatedBy: actorName,
    updatedAt: now,
  });

  if (!(await seedDocExists('payment_submissions', 'pay_001'))) {
    batch5.set(doc(db, 'payment_submissions', 'pay_001'), {
      studentId: 'stu_001',
      studentUid: '',
      admissionNo: 'PUST/BSC-CS/2025/0042',
      studentName: 'Brian Kiprop Mutai',
      channel: 'M-PESA Paybill',
      referenceCode: 'UBK4M92LP1',
      payerPhoneOrBank: '0712345601',
      amount: 16500,
      paymentDate: '2026-10-12',
      status: 'verified',
      verifiedBy: actorName,
      rejectionReason: '',
      receiptNumber: 'PUST-RCT-2026-409182',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('payment_submissions', 'pay_002'))) {
    batch5.set(doc(db, 'payment_submissions', 'pay_002'), {
      studentId: 'stu_002',
      studentUid: '',
      admissionNo: 'PUST/BSC-CS/2025/0118',
      studentName: 'Aisha Mwajuma Hassan',
      channel: 'Bank Deposit',
      referenceCode: 'KCB-8840192',
      payerPhoneOrBank: 'KCB Mvita Branch',
      amount: 33000,
      paymentDate: '2026-11-18',
      status: 'pending_verification',
      verifiedBy: '',
      rejectionReason: '',
      receiptNumber: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('payment_submissions', 'pay_003'))) {
    batch5.set(doc(db, 'payment_submissions', 'pay_003'), {
      studentId: 'stu_003',
      studentUid: '',
      admissionNo: 'PUST/BCOM/2025/0075',
      studentName: 'Faith Wambui Karanja',
      channel: 'M-PESA Paybill',
      referenceCode: 'UCJ7N33KQ9',
      payerPhoneOrBank: '0733612098',
      amount: 7500,
      paymentDate: '2026-11-20',
      status: 'pending_verification',
      verifiedBy: '',
      rejectionReason: '',
      receiptNumber: '',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('scholarships', 'sch_001'))) {
    batch5.set(doc(db, 'scholarships', 'sch_001'), {
      studentId: 'stu_001',
      admissionNo: 'PUST/BSC-CS/2025/0042',
      studentName: 'Brian Kiprop Mutai',
      awardType: 'HELB',
      referenceNo: 'HELB-2026-99401',
      amount: 12000,
      academicYear: '2026/2027',
      awardedBy: actorName,
      createdAt: now,
    });
  }

  if (!(await seedDocExists('course_resources', 'res_001'))) {
    batch5.set(doc(db, 'course_resources', 'res_001'), {
      courseId: 'crs_csc201',
      courseCode: 'CSC 201',
      courseTitle: 'Data Structures & Algorithms',
      title: 'Introduction to Algorithms — Trees, Heaps & Asymptotic Complexity',
      resourceType: 'Textbook / E-Book',
      authorOrEdition: 'Cormen, Leiserson, Rivest & Stein (4th Ed.)',
      summary: 'Core course textbook covering asymptotic notation, recurrence relations, binary search trees, AVL balancing, and graph traversal.',
      contentBody:
        'Chapter 1–4 Reading Digest (CSC 201):\n\n1. Big-O, Big-Omega, and Big-Theta describe asymptotic upper, lower, and tight bounds respectively.\n2. Binary Heap operations: Build-Heap runs in O(n) linear time, while Heap-Extract-Max and Heap-Insert run in O(log n).\n3. Balanced Trees (AVL & Red-Black): Maintain O(log n) worst-case height through single and double rotations.',
      resourceUrl: '',
      fileName: '',
      fileDataUrl: '',
      uploadedByUid: actor.uid,
      uploadedByName: 'Dr. Samuel Ochieng',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('course_resources', 'res_002'))) {
    batch5.set(doc(db, 'course_resources', 'res_002'), {
      courseId: 'crs_csc204',
      courseCode: 'CSC 204',
      courseTitle: 'Database Systems & SQL Design',
      title: 'Relational Normalization (1NF to BCNF) & Indexing Lecture Pack',
      resourceType: 'Lecture Notes',
      authorOrEdition: 'Week 5 Lecture Notes',
      summary: 'Step-by-step worked examples on functional dependencies, lossless join decomposition, and B+ tree indexing.',
      contentBody:
        'Database Normalization Quick Guide:\n\n- 1NF: Eliminate repeating groups; ensure atomic attributes.\n- 2NF: Remove partial dependencies on a composite primary key.\n- 3NF: Remove transitive dependencies between non-key attributes.\n- BCNF: Every determinant must be a candidate key.',
      resourceUrl: '',
      fileName: '',
      fileDataUrl: '',
      uploadedByUid: actor.uid,
      uploadedByName: 'Dr. Amina Salim',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('online_classes', 'cls_001'))) {
    batch5.set(doc(db, 'online_classes', 'cls_001'), {
      courseId: 'crs_csc201',
      courseCode: 'CSC 201',
      courseTitle: 'Data Structures & Algorithms',
      title: 'Live Seminar: AVL Tree Rotations & Priority Queues',
      topicSummary: 'Interactive walkthrough of LL, RR, LR, and RL tree rotations plus live CAT 1 revision Q&A.',
      platform: 'PUST Virtual Room',
      meetingUrl: '',
      passcode: 'CSC201-LIVE',
      scheduledStart: '2026-11-24T10:00',
      durationMinutes: 90,
      status: 'live',
      lecturerUid: actor.uid,
      lecturerName: 'Dr. Samuel Ochieng',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('online_assessments', 'asm_001'))) {
    batch5.set(doc(db, 'online_assessments', 'asm_001'), {
      courseId: 'crs_csc201',
      courseCode: 'CSC 201',
      courseTitle: 'Data Structures & Algorithms',
      assessmentType: 'Online CAT',
      title: 'CAT 1: Algorithm Complexity & Trees',
      instructions: 'Answer all questions within 30 minutes. Multiple-choice items are auto-scored upon submission.',
      durationMinutes: 30,
      dueDate: '2026-12-05T23:59',
      totalMarks: 15,
      status: 'published',
      questions: [
        {
          id: 'q_seed_1',
          prompt: 'What is the worst-case time complexity of searching for a key in a balanced AVL tree with n nodes?',
          kind: 'mcq',
          options: ['O(1)', 'O(log n)', 'O(n)', 'O(n log n)'],
          correctOptionIndex: 1,
          marks: 5,
        },
        {
          id: 'q_seed_2',
          prompt: 'Which data structure is used internally to perform Breadth-First Search (BFS) on a graph?',
          kind: 'mcq',
          options: ['Stack', 'Priority Queue', 'FIFO Queue', 'Hash Table'],
          correctOptionIndex: 2,
          marks: 5,
        },
        {
          id: 'q_seed_3',
          prompt: 'Briefly explain why a binary min-heap is preferred over a sorted array for implementing a priority queue.',
          kind: 'short_answer',
          marks: 5,
        },
      ],
      createdByUid: actor.uid,
      createdByName: 'Dr. Samuel Ochieng',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('course_assignments', 'asg_001'))) {
    batch5.set(doc(db, 'course_assignments', 'asg_001'), {
      courseId: 'crs_csc201',
      courseCode: 'CSC 201',
      courseTitle: 'Data Structures & Algorithms',
      title: 'Assignment 1: Graph Traversal & Shortest Path Solver',
      instructions:
        'Implement Dijkstra shortest-path routing for a Kenyan inter-county campus shuttle network. Submit your complexity summary and repository/PDF deliverable.',
      dueDate: '2026-12-10T23:59',
      maxMarks: 20,
      status: 'open',
      resourceUrl: '',
      fileName: '',
      fileDataUrl: '',
      createdByUid: actor.uid,
      createdByName: 'Dr. Samuel Ochieng',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('student_notifications', 'ntf_001'))) {
    batch5.set(doc(db, 'student_notifications', 'ntf_001'), {
      targetScope: 'course',
      targetStudentId: '',
      targetStudentUid: '',
      courseId: 'crs_csc201',
      courseCode: 'CSC 201',
      courseTitle: 'Data Structures & Algorithms',
      category: 'assignment',
      title: 'New Assignment: Assignment 1: Graph Traversal & Shortest Path Solver',
      message: 'CSC 201 · Due 10 Dec 2026, 23:59 · 20 marks',
      sourceCollection: 'course_assignments',
      sourceId: 'asg_001',
      isRead: false,
      createdByUid: actor.uid,
      createdByName: 'Dr. Samuel Ochieng',
      createdAt: now,
      updatedAt: now,
    });
  }

  if (!(await seedDocExists('study_groups', 'sg_001'))) {
    batch5.set(doc(db, 'study_groups', 'sg_001'), {
      courseId: 'crs_csc201',
      courseCode: 'CSC 201',
      courseTitle: 'Data Structures & Algorithms',
      name: 'CSC 201 AVL & Graph Prep Circle',
      topic: 'Peer problem-solving for AVL tree rotations, min-heaps, and Dijkstra shortest-path lab prep.',
      scheduleNote: 'Tue & Thu · 7:00 PM EAT',
      meetingUrl: '',
      sharedNotes:
        'Shared Revision Checklist:\n1. Review LL, RR, LR, RL rotations before Friday CAT.\n2. Trace Dijkstra with adjacency lists — O((V + E) log V).\n3. Compare BFS vs DFS traversal order on sample past paper graphs.',
      sharedNotesUpdatedBy: actorName,
      status: 'active',
      maxMembers: 20,
      memberCount: 1,
      creatorUid: actor.uid,
      creatorName: actorName,
      creatorAdmissionNo: '',
      createdAt: now,
      updatedAt: now,
    });
    batch5.set(doc(db, 'study_groups', 'sg_001', 'members', actor.uid), {
      groupId: 'sg_001',
      uid: actor.uid,
      studentId: '',
      admissionNo: '',
      displayName: actorName,
      role: 'host',
      joinedAt: now,
    });
    batch5.set(doc(db, 'study_groups', 'sg_001', 'messages', 'sgmsg_001'), {
      groupId: 'sg_001',
      senderUid: actor.uid,
      senderName: actorName,
      senderAdmissionNo: '',
      kind: 'system',
      body: 'Opened the CSC 201 peer study room. Join to collaborate on notes, CAT revision, and past papers.',
      createdAt: now,
    });
  }

  try {
    await batch5.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seedInstitutionalDatabase/batch5_records');
  }

  // Batch 6: Receipts (depends on Payment Submissions) + Audit Log
  const batch6 = writeBatch(db);
  if (!(await seedDocExists('receipts', 'rct_001'))) {
    batch6.set(doc(db, 'receipts', 'rct_001'), {
      receiptNumber: 'PUST-RCT-2026-409182',
      paymentId: 'pay_001',
      studentId: 'stu_001',
      studentUid: '',
      admissionNo: 'PUST/BSC-CS/2025/0042',
      studentName: 'Brian Kiprop Mutai',
      channel: 'M-PESA Paybill',
      referenceCode: 'UBK4M92LP1',
      amount: 16500,
      issuedBy: actorName,
      issuedAt: now,
    });
  }

  batch6.set(doc(db, 'audit_logs', makeId('aud')), {
    actorUid: actor.uid,
    actorName,
    actorRole: actor.role,
    action: 'INSTITUTIONAL_SEED_INITIALIZED',
    entityPath: 'system/bootstrap',
    details: 'Initialized PUST academic structure, Kenyan statutory payroll config, fee structures, sample students, Paybill submissions, staff records, and portal ID bindings.',
    createdAt: now,
  });

  try {
    await batch6.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'seedInstitutionalDatabase/batch6_receipts');
  }
}
