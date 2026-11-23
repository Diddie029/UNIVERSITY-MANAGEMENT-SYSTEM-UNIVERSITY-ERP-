import React, { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  Award,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Receipt as ReceiptIcon,
  Search,
  Send,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import {
  billSemesterFeesForCohort,
  postScholarshipToStudent,
  recordAuditLog,
  rejectPaymentSubmission,
  verifyAndPostPayment,
} from '../lib/erpService';
import { formatKes } from '../lib/kenyaEngine';
import { exportToCSV, generateFeeStatementPDF, generateReceiptPDF } from '../lib/pdfGenerator';
import { PaymentSubmission } from '../types/erp';

interface FinanceModuleProps {
  data: ErpDataset;
}

export function FinanceModule({ data }: FinanceModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { showToast } = useToast();

  const isFinanceStaff = ['super_admin', 'management', 'finance'].includes(effectiveRole);

  const [tab, setTab] = useState<'reconciliation' | 'accounts' | 'structures' | 'scholarships'>(
    effectiveRole === 'student' ? 'accounts' : 'reconciliation'
  );
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_verification' | 'verified' | 'rejected'>('all');

  // Submit Payment Reference Form
  const [payStudentId, setPayStudentId] = useState('');
  const [payChannel, setPayChannel] = useState<PaymentSubmission['channel']>('M-PESA Paybill');
  const [payRef, setPayRef] = useState('');
  const [paySource, setPaySource] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [submittingPay, setSubmittingPay] = useState(false);

  // Verify / Reject Dialogs
  const [verifyTarget, setVerifyTarget] = useState<PaymentSubmission | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PaymentSubmission | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [reconciling, setReconciling] = useState(false);

  // Fee Structure Form
  const [fsProgId, setFsProgId] = useState('');
  const [fsCategory, setFsCategory] = useState<'KUCCPS' | 'Self-Sponsored'>('KUCCPS');
  const [fsTuition, setFsTuition] = useState('22000');
  const [fsExam, setFsExam] = useState('2500');
  const [fsLibMed, setFsLibMed] = useState('2500');
  const [fsActIct, setFsActIct] = useState('1500');
  const [billingCohort, setBillingCohort] = useState(false);

  // Scholarship Form
  const [schStudentId, setSchStudentId] = useState('');
  const [schType, setSchType] = useState<'HELB' | 'County Bursary' | 'Merit Scholarship' | 'CDF Bursary'>('HELB');
  const [schRef, setSchRef] = useState('');
  const [schAmount, setSchAmount] = useState('');
  const [postingSch, setPostingSch] = useState(false);

  const activeCalendar = data.calendars.find((c) => c.isActive) ?? data.calendars[0];
  const academicYear = activeCalendar?.academicYear || '2026/2027';
  const semesterName = activeCalendar?.semesterName || 'Semester I (Sept - Dec)';

  const isSuperAdmin = profile?.role === 'super_admin';
  const myStudent =
    effectiveRole === 'student'
      ? data.students.find((s) => s.id === profile?.studentId || s.uid === firebaseUser?.uid) ??
        (isSuperAdmin ? data.students[0] : undefined)
      : undefined;

  const targetStudentId =
    effectiveRole === 'student' ? myStudent?.id || '' : payStudentId || data.students[0]?.id || '';

  const scopedAccounts =
    effectiveRole === 'student'
      ? myStudent
        ? data.studentAccounts.filter((a) => a.studentId === myStudent.id)
        : []
      : data.studentAccounts;

  const scopedPayments =
    effectiveRole === 'student'
      ? myStudent
        ? data.payments.filter((p) => p.studentId === myStudent.id)
        : []
      : data.payments;

  const scopedReceipts =
    effectiveRole === 'student'
      ? myStudent
        ? data.receipts.filter((r) => r.studentId === myStudent.id)
        : []
      : data.receipts;

  const filteredPayments = scopedPayments.filter((p) => {
    const matchesSearch =
      !search.trim() ||
      p.studentName.toLowerCase().includes(search.toLowerCase()) ||
      p.admissionNo.toLowerCase().includes(search.toLowerCase()) ||
      p.referenceCode.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || p.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleSubmitPaymentRef = async (e: React.FormEvent) => {
    e.preventDefault();
    const stu = data.students.find((s) => s.id === targetStudentId);
    if (!stu) {
      showToast('Select a valid enrolled student record first.', 'error');
      return;
    }
    const amt = Number(payAmount);
    if (!amt || amt <= 0) {
      showToast('Enter a valid positive KES amount.', 'error');
      return;
    }

    setSubmittingPay(true);
    const paymentId = makeId('pay');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'payment_submissions', paymentId), {
        studentId: stu.id,
        studentUid: stu.uid || firebaseUser?.uid || '',
        admissionNo: stu.admissionNo,
        studentName: stu.fullName,
        channel: payChannel,
        referenceCode: clampStr(payRef.toUpperCase(), 48),
        payerPhoneOrBank: clampStr(paySource, 80),
        amount: amt,
        paymentDate: payDate,
        status: 'pending_verification',
        verifiedBy: '',
        rejectionReason: '',
        receiptNumber: '',
        createdAt: now,
        updatedAt: now,
      });
      showToast(
        'Payment reference submitted as Pending Verification. Balance updates only after Finance Officer reconciliation.',
        'info'
      );
      setPayRef('');
      setPaySource('');
      setPayAmount('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `payment_submissions/${paymentId}`);
    } finally {
      setSubmittingPay(false);
    }
  };

  const handleConfirmVerify = async () => {
    if (!verifyTarget || !firebaseUser || !profile) return;
    setReconciling(true);
    try {
      const acct = data.studentAccounts.find((a) => a.studentId === verifyTarget.studentId);
      const rct = await verifyAndPostPayment(verifyTarget, acct, {
        uid: firebaseUser.uid,
        name: profile.displayName,
        role: profile.role,
      });
      showToast(`Verified ${verifyTarget.referenceCode} and issued receipt ${rct}.`, 'success');
      setVerifyTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Verification failed.', 'error');
    } finally {
      setReconciling(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectTarget || !firebaseUser || !profile) return;
    setReconciling(true);
    try {
      await rejectPaymentSubmission(rejectTarget, rejectReason, {
        uid: firebaseUser.uid,
        name: profile.displayName,
        role: profile.role,
      });
      showToast(`Payment ${rejectTarget.referenceCode} rejected.`, 'info');
      setRejectTarget(null);
      setRejectReason('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rejection failed.', 'error');
    } finally {
      setReconciling(false);
    }
  };

  const handleSaveFeeStructure = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const prog = data.programmes.find((p) => p.id === (fsProgId || data.programmes[0]?.id));
    if (!prog) {
      showToast('Select a programme.', 'error');
      return;
    }
    const tuitionFee = Number(fsTuition) || 0;
    const examFee = Number(fsExam) || 0;
    const libraryMedicalFee = Number(fsLibMed) || 0;
    const activityIctFee = Number(fsActIct) || 0;
    const totalFee = tuitionFee + examFee + libraryMedicalFee + activityIctFee;
    const structId = `${prog.id}_${fsCategory.toLowerCase().replace(/[^a-z]/g, '')}`;

    try {
      await setDoc(doc(db, 'fee_structures', structId), {
        programmeId: prog.id,
        programmeName: prog.name,
        academicYear,
        semesterName,
        category: fsCategory,
        tuitionFee,
        examFee,
        libraryMedicalFee,
        activityIctFee,
        totalFee,
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'FEE_STRUCTURE_UPDATED',
        `fee_structures/${structId}`,
        `Set ${prog.code} (${fsCategory}) semester fee to KES ${totalFee}.`
      );
      showToast(`Saved fee structure for ${prog.code} (${formatKes(totalFee)}).`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `fee_structures/${structId}`);
    }
  };

  const handleBillActiveCohort = async () => {
    if (!firebaseUser || !profile) return;
    setBillingCohort(true);
    try {
      const count = await billSemesterFeesForCohort(
        data.students,
        data.studentAccounts,
        data.feeStructures,
        academicYear,
        semesterName,
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role }
      );
      showToast(`Billed semester fees to ${count} active student accounts.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Billing failed.', 'error');
    } finally {
      setBillingCohort(false);
    }
  };

  const handlePostScholarship = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const stu = data.students.find((s) => s.id === (schStudentId || data.students[0]?.id));
    if (!stu) return;
    const amt = Number(schAmount);
    if (!amt || amt <= 0) {
      showToast('Enter a positive scholarship amount.', 'error');
      return;
    }
    setPostingSch(true);
    try {
      const acct = data.studentAccounts.find((a) => a.studentId === stu.id);
      await postScholarshipToStudent(stu, acct, schType, schRef, amt, academicYear, {
        uid: firebaseUser.uid,
        name: profile.displayName,
        role: profile.role,
      });
      showToast(`Posted ${schType} credit (${formatKes(amt)}) to ${stu.admissionNo}.`, 'success');
      setSchRef('');
      setSchAmount('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to post award.', 'error');
    } finally {
      setPostingSch(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Finance, Student Accounts &amp; Paybill Reconciliation
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            M-PESA Paybill 522522 · Bank deposits require manual Finance verification before balance credit and receipt issuance.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('reconciliation')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === 'reconciliation'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {isFinanceStaff ? 'Paybill & Bank Queue' : 'Submit Paybill / Bank Ref'}
          </button>
          <button
            type="button"
            onClick={() => setTab('accounts')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              tab === 'accounts'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {isFinanceStaff ? 'Ledgers & Receipts' : 'My Fee Ledger & Receipts'}
          </button>
          {isFinanceStaff && (
            <>
              <button
                type="button"
                onClick={() => setTab('structures')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'structures'
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Fee Structures
              </button>
              <button
                type="button"
                onClick={() => setTab('scholarships')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === 'scholarships'
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                HELB &amp; Bursaries
              </button>
            </>
          )}
        </div>
      </div>

      {/* TAB 1: Paybill Submission + Finance Reconciliation Queue */}
      {tab === 'reconciliation' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSubmitPaymentRef}
            className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4 self-start"
          >
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Submit Fee Payment Reference
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Pay via Paybill 522522 (Account: Admission No) or KCB Bank, then log your code here.
              </p>
            </div>

            {isFinanceStaff && (
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Student Account
                </label>
                <select
                  value={targetStudentId}
                  onChange={(e) => setPayStudentId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  {data.students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.admissionNo} — {s.fullName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Payment Channel
              </label>
              <select
                value={payChannel}
                onChange={(e) => setPayChannel(e.target.value as PaymentSubmission['channel'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                <option value="M-PESA Paybill">M-PESA Paybill (522522)</option>
                <option value="Bank Deposit">Bank Deposit Slip</option>
                <option value="EFT Transfer">EFT / RTGS Transfer</option>
                <option value="HELB Disbursement">HELB Disbursement</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Transaction Reference Code
              </label>
              <input
                type="text"
                required
                value={payRef}
                onChange={(e) => setPayRef(e.target.value)}
                placeholder="e.g. UCK8M29LP1 or KCB-884019"
                className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Amount (KES)
                </label>
                <input
                  type="number"
                  required
                  min={1}
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  placeholder="15000"
                  className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Payment Date
                </label>
                <input
                  type="date"
                  required
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Sender Phone or Bank Branch
              </label>
              <input
                type="text"
                value={paySource}
                onChange={(e) => setPaySource(e.target.value)}
                placeholder="e.g. 0712345678 or KCB Mvita"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>

            <button
              type="submit"
              disabled={submittingPay || !targetStudentId}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{submittingPay ? 'Submitting...' : 'Submit for Verification'}</span>
            </button>
          </form>

          {/* Reconciliation Table */}
          <div className="lg:col-span-8 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by reference, admission no, or student..."
                  className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]"
                />
              </div>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                {(['all', 'pending_verification', 'verified', 'rejected'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setStatusFilter(st)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      statusFilter === st
                        ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {st === 'all' ? 'All' : st === 'pending_verification' ? 'Pending' : st}
                  </button>
                ))}
              </div>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-3 px-4 font-medium">Reference &amp; Channel</th>
                    <th className="py-3 px-4 font-medium">Student</th>
                    <th className="py-3 px-4 font-medium text-right">Amount</th>
                    <th className="py-3 px-4 font-medium">Verification Status</th>
                    <th className="py-3 px-4 font-medium text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {filteredPayments.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                        No payment submissions match this filter.
                      </td>
                    </tr>
                  ) : (
                    filteredPayments.map((p) => {
                      const receipt = data.receipts.find((r) => r.paymentId === p.id);
                      return (
                        <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                          <td className="py-3 px-4">
                            <p className="font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                              {p.referenceCode}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {p.channel} · {p.paymentDate}
                            </p>
                          </td>
                          <td className="py-3 px-4">
                            <p className="font-medium text-slate-900 dark:text-slate-100">{p.studentName}</p>
                            <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                              {p.admissionNo}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                            {formatKes(p.amount)}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`text-xs font-semibold ${
                                p.status === 'verified'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : p.status === 'rejected'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {p.status === 'pending_verification'
                                ? 'Pending Verification'
                                : p.status === 'verified'
                                ? 'Verified'
                                : 'Rejected'}
                            </span>
                            {p.receiptNumber && (
                              <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                {p.receiptNumber}
                              </p>
                            )}
                            {p.rejectionReason && (
                              <p className="text-[11px] text-red-500 dark:text-red-400">{p.rejectionReason}</p>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                            {p.status === 'verified' && receipt && (
                              <button
                                type="button"
                                onClick={() => generateReceiptPDF(receipt)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Receipt PDF</span>
                              </button>
                            )}
                            {isFinanceStaff && p.status === 'pending_verification' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setVerifyTarget(p)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Verify &amp; Post</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRejectTarget(p)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                                >
                                  <XCircle className="w-3.5 h-3.5" />
                                  <span>Reject</span>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Student Fee Accounts & Official Receipts */}
      {tab === 'accounts' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Student Fee Accounts &amp; Balances
            </h3>
            {isFinanceStaff && (
              <button
                type="button"
                onClick={() =>
                  exportToCSV(
                    'EDUVANCE_Fee_Balances.csv',
                    ['Admission No', 'Student', 'Total Billed', 'Verified Paid', 'Scholarships', 'Balance', 'Cleared'],
                    data.studentAccounts.map((a) => [
                      a.admissionNo,
                      a.studentName,
                      a.totalBilled,
                      a.totalPaid,
                      a.scholarshipsTotal,
                      a.balance,
                      a.cleared,
                    ])
                  )
                }
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-amber-500" />
                <span>Export Revenue &amp; Arrears CSV</span>
              </button>
            )}
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Admission No</th>
                  <th className="py-3 px-4 font-medium">Student</th>
                  <th className="py-3 px-4 font-medium text-right">Billed</th>
                  <th className="py-3 px-4 font-medium text-right">Verified Paid</th>
                  <th className="py-3 px-4 font-medium text-right">HELB / Bursary</th>
                  <th className="py-3 px-4 font-medium text-right">Balance</th>
                  <th className="py-3 px-4 font-medium text-right">Statement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {scopedAccounts.map((acct) => {
                  const stu = data.students.find((s) => s.id === acct.studentId);
                  const stuPays = scopedPayments.filter((p) => p.studentId === acct.studentId);
                  return (
                    <tr key={acct.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                        {acct.admissionNo}
                      </td>
                      <td className="py-3 px-4 font-medium">{acct.studentName}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(acct.totalBilled)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatKes(acct.totalPaid)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        {formatKes(acct.scholarshipsTotal)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-bold ${
                          acct.balance > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {formatKes(acct.balance)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {stu && (
                          <button
                            type="button"
                            onClick={() => generateFeeStatementPDF(stu, acct, stuPays)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Statement PDF</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <ReceiptIcon className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Issued Official Receipts
              </h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Receipt No</th>
                  <th className="py-3 px-4 font-medium">Student</th>
                  <th className="py-3 px-4 font-medium">Channel &amp; Ref</th>
                  <th className="py-3 px-4 font-medium text-right">Amount</th>
                  <th className="py-3 px-4 font-medium text-right">Download</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {scopedReceipts.map((rct) => (
                  <tr key={rct.id}>
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {rct.receiptNumber}
                    </td>
                    <td className="py-3 px-4">
                      {rct.studentName}
                      <span className="block text-xs font-mono text-slate-500">{rct.admissionNo}</span>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {rct.channel} · <span className="font-mono">{rct.referenceCode}</span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                      {formatKes(rct.amount)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => generateReceiptPDF(rct)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Fee Structures & Semester Billing */}
      {tab === 'structures' && isFinanceStaff && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSaveFeeStructure}
            className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4 self-start"
          >
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Configure Programme Fee Structure
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Programme</label>
                <select
                  value={fsProgId || data.programmes[0]?.id || ''}
                  onChange={(e) => setFsProgId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  {data.programmes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Student Category</label>
                <select
                  value={fsCategory}
                  onChange={(e) => setFsCategory(e.target.value as 'KUCCPS' | 'Self-Sponsored')}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="KUCCPS">KUCCPS (Government-Sponsored)</option>
                  <option value="Self-Sponsored">Self-Sponsored</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Tuition (KES)</label>
                <input type="number" value={fsTuition} onChange={(e) => setFsTuition(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Exam Fee</label>
                <input type="number" value={fsExam} onChange={(e) => setFsExam(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Library &amp; Medical</label>
                <input type="number" value={fsLibMed} onChange={(e) => setFsLibMed(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Activity &amp; ICT</label>
                <input type="number" value={fsActIct} onChange={(e) => setFsActIct(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              </div>
            </div>
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              <Plus className="w-4 h-4" />
              <span>Save Fee Structure</span>
            </button>
          </form>

          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4">
              <div>
                <p className="text-sm font-semibold">Semester Fee Invoicing</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Post {academicYear} {semesterName} fees to all Active students matching their programme &amp; category.
                </p>
              </div>
              <button
                type="button"
                disabled={billingCohort}
                onClick={handleBillActiveCohort}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white whitespace-nowrap disabled:opacity-60"
              >
                {billingCohort ? 'Billing...' : 'Bill Active Cohort'}
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-3 px-4 font-medium">Programme</th>
                    <th className="py-3 px-4 font-medium">Category</th>
                    <th className="py-3 px-4 font-medium text-right">Tuition</th>
                    <th className="py-3 px-4 font-medium text-right">Total Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {data.feeStructures.map((fs) => (
                    <tr key={fs.id}>
                      <td className="py-3 px-4 font-medium">{fs.programmeName}</td>
                      <td className="py-3 px-4 text-xs">{fs.category}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(fs.tuitionFee)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold">
                        {formatKes(fs.totalFee)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: HELB & Scholarships */}
      {tab === 'scholarships' && isFinanceStaff && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handlePostScholarship}
            className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4 self-start"
          >
            <div className="flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Post HELB / Bursary Allocation</h3>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Student</label>
              <select
                value={schStudentId || data.students[0]?.id || ''}
                onChange={(e) => setSchStudentId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {data.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.admissionNo} — {s.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Funding Source</label>
              <select
                value={schType}
                onChange={(e) => setSchType(e.target.value as 'HELB' | 'County Bursary' | 'Merit Scholarship' | 'CDF Bursary')}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                <option value="HELB">HELB Loan / Tuition Upkeep</option>
                <option value="County Bursary">County Bursary</option>
                <option value="CDF Bursary">NG-CDF Bursary</option>
                <option value="Merit Scholarship">Vice Chancellor Merit Scholarship</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Batch / Voucher Ref</label>
              <input
                type="text"
                required
                value={schRef}
                onChange={(e) => setSchRef(e.target.value)}
                placeholder="HELB-2026-10291"
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Amount (KES)</label>
              <input
                type="number"
                required
                min={1}
                value={schAmount}
                onChange={(e) => setSchAmount(e.target.value)}
                placeholder="20000"
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <button
              type="submit"
              disabled={postingSch}
              className="w-full px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              {postingSch ? 'Crediting Account...' : 'Credit Scholarship to Student'}
            </button>
          </form>

          <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Student</th>
                  <th className="py-3 px-4 font-medium">Award Type</th>
                  <th className="py-3 px-4 font-medium">Reference</th>
                  <th className="py-3 px-4 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.scholarships.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3 px-4">
                      {s.studentName}
                      <span className="block text-xs font-mono text-slate-500">{s.admissionNo}</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold">{s.awardType}</td>
                    <td className="py-3 px-4 font-mono text-xs">{s.referenceNo}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatKes(s.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(verifyTarget)}
        title="Verify Payment & Issue Official Receipt"
        description={
          verifyTarget
            ? `Confirm that ${verifyTarget.channel} reference ${verifyTarget.referenceCode} for ${formatKes(
                verifyTarget.amount
              )} has been matched on bank/Paybill statements for ${verifyTarget.studentName} (${
                verifyTarget.admissionNo
              }).`
            : ''
        }
        confirmLabel="Verify, Post & Issue Receipt"
        loading={reconciling}
        onConfirm={handleConfirmVerify}
        onCancel={() => setVerifyTarget(null)}
      />

      {rejectTarget && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Reject Payment Reference — {rejectTarget.referenceCode}
            </h3>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Transaction code not found on Paybill 522522 statement."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectReason('');
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={reconciling}
                onClick={handleConfirmReject}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white"
              >
                {reconciling ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
