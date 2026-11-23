import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  AdmissionApplication,
  ExamMark,
  PaymentSubmission,
  Payslip,
  Receipt,
  Student,
  StudentAccount,
} from '../types/erp';
import { formatKes } from './kenyaEngine';

function addInstitutionalHeader(doc: jsPDF, documentTitle: string, referenceNo: string) {
  doc.setFillColor(11, 17, 32);
  doc.rect(0, 0, 210, 32, 'F');
  doc.setTextColor(245, 158, 11);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text('EDUVANCE ERP — UNIVERSITY MANAGEMENT ECOSYSTEM', 14, 14);
  doc.setTextColor(226, 232, 240);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('Office of the Registrar & Finance · P.O. Box 90420-80100, Mombasa, Kenya', 14, 21);
  doc.text(`Ref: ${referenceNo}  |  Generated: ${new Date().toLocaleDateString('en-KE')}`, 14, 27);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(documentTitle.toUpperCase(), 14, 44);
  doc.setDrawColor(203, 213, 225);
  doc.line(14, 47, 196, 47);
}

export function generateAdmissionLetterPDF(app: AdmissionApplication) {
  const doc = new jsPDF();
  const admNo = app.generatedAdmissionNo || 'PENDING';
  addInstitutionalHeader(doc, 'Provisional Letter of Admission', admNo);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  let y = 58;
  const lines = [
    `Date: ${new Date().toLocaleDateString('en-KE', { dateStyle: 'long' })}`,
    `Dear ${app.fullName},`,
    '',
    'Following your application to EDUVANCE ERP University Portal, the',
    'University Senate Admissions Board is pleased to offer you provisional admission into:',
    '',
  ];
  lines.forEach((line) => {
    doc.text(line, 14, y);
    y += 6;
  });

  autoTable(doc, {
    startY: y,
    head: [['Admission Parameter', 'Official Record']],
    body: [
      ['Admission Number', admNo],
      ['Programme Offered', app.programmeName || app.programmeId],
      ['Entry Category', app.entryCategory],
      ['Intake Cohort', app.intake || 'September 2026'],
      ['National ID / Passport', app.nationalId],
      ['KCSE Mean Grade', app.kcseMeanGrade],
      ['Application Fee Ref', app.appFeePaybillRef],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y + 60;
  doc.setFontSize(9.5);
  doc.text(
    'Please report for biometric registration and Paybill fee settlement (Paybill 522522) before the semester deadline.',
    14,
    finalY + 12
  );
  doc.setFont('helvetica', 'bold');
  doc.text('Prof. J. Mwangi — Academic Registrar', 14, finalY + 28);
  doc.save(`EDUVANCE_Admission_Letter_${admNo.replace(/\//g, '_')}.pdf`);
}

export function generateReceiptPDF(receipt: Receipt) {
  const doc = new jsPDF();
  addInstitutionalHeader(doc, 'Official Fee Payment Receipt', receipt.receiptNumber);

  autoTable(doc, {
    startY: 56,
    head: [['Field', 'Verified Transaction Detail']],
    body: [
      ['Receipt Number', receipt.receiptNumber],
      ['Student Name', receipt.studentName],
      ['Admission Number', receipt.admissionNo],
      ['Payment Channel', receipt.channel],
      ['Bank / M-PESA Reference', receipt.referenceCode],
      ['Amount Credited', formatKes(receipt.amount)],
      ['Verified & Issued By', receipt.issuedBy],
      ['Official Issue Timestamp', new Date(receipt.issuedAt).toLocaleString('en-KE')],
    ],
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 130;
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('This is a verified official receipt from EDUVANCE Finance Office. Retain for examination & clearance.', 14, finalY + 12);
  doc.save(`EDUVANCE_Receipt_${receipt.receiptNumber}.pdf`);
}

export function generateFeeStatementPDF(
  student: Student,
  account: StudentAccount | undefined,
  payments: PaymentSubmission[]
) {
  const doc = new jsPDF();
  addInstitutionalHeader(doc, 'Official Student Fee Statement', student.admissionNo);

  autoTable(doc, {
    startY: 54,
    head: [['Student Profile', 'Account Summary']],
    body: [
      [`Name: ${student.fullName}`, `Total Billed: ${formatKes(account?.totalBilled ?? 0)}`],
      [`Admission No: ${student.admissionNo}`, `Total Verified Paid: ${formatKes(account?.totalPaid ?? 0)}`],
      [`Programme: ${student.programmeName || student.programmeId}`, `Scholarships / HELB: ${formatKes(account?.scholarshipsTotal ?? 0)}`],
      [`Category: ${student.category}`, `Outstanding Balance: ${formatKes(account?.balance ?? 0)}`],
    ],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
  });

  const startY = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 100) + 10;
  autoTable(doc, {
    startY,
    head: [['Date', 'Channel', 'Reference', 'Amount (KES)', 'Verification Status', 'Receipt']],
    body:
      payments.length > 0
        ? payments.map((p) => [
            p.paymentDate,
            p.channel,
            p.referenceCode,
            formatKes(p.amount),
            p.status.replace('_', ' ').toUpperCase(),
            p.receiptNumber || '—',
          ])
        : [['—', 'No payment records found', '—', '—', '—', '—']],
    theme: 'striped',
    headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] },
  });

  doc.save(`EDUVANCE_Fee_Statement_${student.admissionNo.replace(/\//g, '_')}.pdf`);
}

export function generateTranscriptPDF(student: Student, marks: ExamMark[]) {
  const doc = new jsPDF();
  addInstitutionalHeader(doc, 'Official Academic Transcript', student.admissionNo);

  const published = marks.filter((m) => m.workflowStatus === 'published');
  const totalUnits = published.reduce((acc, m) => acc + (m.creditUnits ?? 3), 0);
  const weightedPoints = published.reduce((acc, m) => acc + (m.gradePoints ?? 0) * (m.creditUnits ?? 3), 0);
  const gpa = totalUnits > 0 ? (weightedPoints / totalUnits).toFixed(2) : '0.00';

  doc.setFontSize(10);
  doc.text(`Student: ${student.fullName}   |   Admission No: ${student.admissionNo}`, 14, 56);
  doc.text(`Programme: ${student.programmeName || student.programmeId}   |   Year ${student.yearOfStudy} Sem ${student.semester}`, 14, 62);

  autoTable(doc, {
    startY: 68,
    head: [['Course Code', 'Unit Title', 'Units', 'CAT (/30)', 'Exam (/70)', 'Total', 'Grade']],
    body:
      published.length > 0
        ? published.map((m) => [
            m.courseCode,
            m.courseTitle || m.courseCode,
            String(m.creditUnits ?? 3),
            String(m.catScore),
            String(m.examScore),
            String(m.totalScore),
            m.grade,
          ])
        : [['—', 'No published examination results available yet', '—', '—', '—', '—', '—']],
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 120;
  doc.setFont('helvetica', 'bold');
  doc.text(`Cumulative GPA: ${gpa} / 4.00   |   Total Credits Earned: ${totalUnits}`, 14, finalY + 12);
  doc.save(`EDUVANCE_Transcript_${student.admissionNo.replace(/\//g, '_')}.pdf`);
}

export function generatePayslipPDF(payslip: Payslip) {
  const doc = new jsPDF();
  addInstitutionalHeader(doc, `Employee Monthly Payslip — ${payslip.monthLabel}`, payslip.staffNo);

  autoTable(doc, {
    startY: 56,
    head: [['Earnings & Statutory Item', 'Amount (KES)']],
    body: [
      ['Employee Name', payslip.employeeName],
      ['Staff Number / Role', `${payslip.staffNo} — ${payslip.jobTitle || 'Staff'}`],
      ['Basic Salary', formatKes(payslip.basicSalary)],
      ['Allowances (House + Commuter)', formatKes(payslip.allowances ?? 0)],
      ['Gross Pay', formatKes(payslip.grossPay)],
      ['NSSF Contribution (Tier I & II)', `-${formatKes(payslip.nssf)}`],
      ['SHIF Contribution (2.75%)', `-${formatKes(payslip.shif)}`],
      ['Affordable Housing Levy (1.5%)', `-${formatKes(payslip.housingLevy)}`],
      ['Pension Contribution', `-${formatKes(payslip.pension ?? 0)}`],
      ['Taxable Income', formatKes(payslip.taxablePay ?? 0)],
      ['P.A.Y.E Income Tax (Net of Relief)', `-${formatKes(payslip.paye)}`],
      ['NET PAY DISBURSED', formatKes(payslip.netPay)],
      ['Bank & Account', `${payslip.bankName || 'KCB Bank'} (${payslip.bankAccountMasked || '****'})`],
    ],
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255] },
  });

  doc.save(`EDUVANCE_Payslip_${payslip.staffNo}_${payslip.monthLabel.replace(/\s+/g, '_')}.pdf`);
}

export function exportToCSV(filename: string, headers: string[], rows: (string | number | boolean)[][]) {
  const escape = (val: string | number | boolean) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
