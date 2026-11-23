import React, { useState } from 'react';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../components/Toast';
import { ErpDataset } from '../hooks/useErpData';
import { formatKes } from '../lib/kenyaEngine';
import { seedInstitutionalDatabase } from '../lib/seedData';
import {
  exportToCSV,
  generateAdmissionLetterPDF,
  generateFeeStatementPDF,
  generateTranscriptPDF,
} from '../lib/pdfGenerator';
import { ErpSection, ROLE_LABELS } from '../types/erp';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend);

interface DashboardModuleProps {
  data: ErpDataset;
  onNavigate: (section: ErpSection) => void;
}

export function DashboardModule({ data, onNavigate }: DashboardModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { theme } = useTheme();
  const { showToast } = useToast();
  const [seeding, setSeeding] = useState(false);

  const isEmpty = data.programmes.length === 0 && data.students.length === 0;
  const isSuperAdmin = profile?.role === 'super_admin';

  const handleSeed = async () => {
    if (!firebaseUser || !profile) return;
    setSeeding(true);
    try {
      await seedInstitutionalDatabase({
        uid: firebaseUser.uid,
        name: profile.displayName,
        role: profile.role,
      });
      showToast('Institutional dataset initialized in Firestore.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to initialize seed data.', 'error');
    } finally {
      setSeeding(false);
    }
  };

  // Real Aggregations from Firestore
  const totalStudents = data.students.length;
  const activeStudents = data.students.filter((s) => s.academicStatus === 'Active').length;
  const pendingApps = data.applications.filter(
    (a) => a.status === 'submitted' || a.status === 'under_review'
  ).length;
  const totalBilled = data.studentAccounts.reduce((s, a) => s + Number(a.totalBilled || 0), 0);
  const totalCollected = data.studentAccounts.reduce((s, a) => s + Number(a.totalPaid || 0), 0);
  const totalScholarships = data.studentAccounts.reduce((s, a) => s + Number(a.scholarshipsTotal || 0), 0);
  const totalOutstanding = data.studentAccounts.reduce((s, a) => s + Math.max(0, Number(a.balance || 0)), 0);
  const pendingPayments = data.payments.filter((p) => p.status === 'pending_verification');
  const pendingPaymentsSum = pendingPayments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const activeEmployees = data.employees.filter((e) => e.status === 'Active').length;
  const monthlyBasicPool = data.employees
    .filter((e) => e.status === 'Active')
    .reduce(
      (s, e) => s + Number(e.basicSalary || 0) + Number(e.houseAllowance || 0) + Number(e.commuterAllowance || 0),
      0
    );

  const gridColor = theme === 'dark' ? 'rgba(148, 163, 184, 0.12)' : 'rgba(15, 23, 42, 0.08)';
  const tickColor = theme === 'dark' ? '#94A3B8' : '#475569';

  const channels = ['M-PESA Paybill', 'Bank Deposit', 'EFT Transfer', 'HELB Disbursement'] as const;
  const channelTotals = channels.map((ch) =>
    data.payments
      .filter((p) => p.channel === ch && p.status === 'verified')
      .reduce((sum, p) => sum + Number(p.amount || 0), 0)
  );

  const financeChartData = {
    labels: ['Billed Fees', 'Verified Paid', 'HELB / Bursaries', 'Outstanding Arrears'],
    datasets: [
      {
        label: 'KES Amount',
        data: [totalBilled, totalCollected, totalScholarships, totalOutstanding],
        backgroundColor: ['#3B82F6', '#16A34A', '#F59E0B', '#DC2626'],
        borderRadius: 6,
      },
    ],
  };

  const progCounts = data.programmes.map((p) => ({
    name: p.code,
    count: data.students.filter((s) => s.programmeId === p.id).length,
  }));

  const enrollmentDoughnutData = {
    labels: progCounts.length > 0 ? progCounts.map((p) => p.name) : ['No Data'],
    datasets: [
      {
        data: progCounts.length > 0 ? progCounts.map((p) => p.count) : [1],
        backgroundColor: ['#F59E0B', '#3B82F6', '#10B981', '#6366F1'],
        borderWidth: 0,
      },
    ],
  };

  // Strictly scoped student resolution (only previews data.students[0] for Super Admin Role Preview)
  const myStudent =
    data.students.find((s) => s.id === profile?.studentId || s.uid === firebaseUser?.uid) ??
    (effectiveRole === 'student' && isSuperAdmin ? data.students[0] : undefined);
  const myAccount = myStudent
    ? data.studentAccounts.find((a) => a.studentId === myStudent.id)
    : undefined;
  const myMarks = myStudent
    ? data.examMarks.filter((m) => m.studentId === myStudent.id && m.workflowStatus === 'published')
    : [];
  const myRegs = myStudent
    ? data.registrations.filter((r) => r.studentId === myStudent.id && r.status === 'registered')
    : [];
  const myPayments = myStudent ? data.payments.filter((p) => p.studentId === myStudent.id) : [];

  const activeCalendar = data.calendars.find((c) => c.isActive);
  const canExportFinanceLedger = ['super_admin', 'management', 'finance'].includes(effectiveRole);
  const isAcademicRole = ['lecturer', 'hod', 'exam_officer'].includes(effectiveRole);

  return (
    <div className="space-y-6">
      {/* Header Context Banner */}
      <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5">
        <div className="space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {ROLE_LABELS[effectiveRole]} Workspace
            {activeCalendar ? ` · ${activeCalendar.academicYear} · ${activeCalendar.semesterName}` : ''}
          </p>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Welcome, {profile?.displayName || firebaseUser?.displayName || 'Portal User'}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isEmpty && isSuperAdmin && (
            <button
              type="button"
              disabled={seeding}
              onClick={handleSeed}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              <Database className="w-4 h-4" />
              <span>{seeding ? 'Initializing Database...' : 'Initialize University Seed Data'}</span>
            </button>
          )}
          {canExportFinanceLedger && (
            <button
              type="button"
              onClick={() =>
                exportToCSV(
                  'EDUVANCE_Financial_Summary.csv',
                  ['Admission No', 'Student Name', 'Total Billed', 'Verified Paid', 'Scholarships', 'Balance', 'Cleared'],
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
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-amber-500 transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="w-4 h-4 text-amber-500" />
              <span>Export Ledger CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Empty Seed Notice */}
      {isEmpty && (
        <div className="border border-amber-500/40 bg-amber-500/10 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Firestore Database Has No Seeded Institutional Records Yet
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {isSuperAdmin
                  ? 'Click "Initialize University Seed Data" above to populate Faculties, Programmes, Fee Structures, Students, Paybill Submissions, Kenyan HR Staff, and Portal Login IDs.'
                  : 'Ask your Super Administrator to initialize faculties, programmes, and academic calendars.'}
              </p>
            </div>
          </div>
          {isSuperAdmin && (
            <button
              type="button"
              disabled={seeding}
              onClick={handleSeed}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
            >
              {seeding ? 'Seeding...' : 'Seed Now'}
            </button>
          )}
        </div>
      )}

      {/* 1. STUDENT PORTAL VIEW */}
      {effectiveRole === 'student' ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Fee Balance</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {formatKes(myAccount?.balance ?? 0)}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {myStudent ? (myAccount?.cleared ? 'Financially Cleared' : 'Balance Due') : 'Not Linked'}
              </p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Registered Units</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {myRegs.length}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Active Semester</p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Published Results</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {myMarks.length}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Senate Approved Units</p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Admission Number</p>
              <p className="text-base font-bold font-mono text-amber-600 dark:text-amber-400 pt-1">
                {myStudent?.admissionNo || 'Not Linked Yet'}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{myStudent?.programmeName || 'Pending'}</p>
            </div>
          </div>

          {myStudent ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => generateFeeStatementPDF(myStudent, myAccount, myPayments)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                <Download className="w-4 h-4" />
                <span>Download Fee Statement PDF</span>
              </button>
              <button
                type="button"
                onClick={() => generateTranscriptPDF(myStudent, myMarks)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 hover:border-amber-500"
              >
                <Download className="w-4 h-4" />
                <span>Download Official Transcript PDF</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('resources')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 hover:border-amber-500"
              >
                <span>Open Books, Classes &amp; Assignments</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onNavigate('finance')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 hover:border-amber-500"
              >
                <span>Submit M-PESA Paybill Ref</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 text-sm text-slate-600 dark:text-slate-300">
              Your account is not yet linked to a student admission record. Sign out and sign back in using the{' '}
              <span className="font-semibold text-amber-600 dark:text-amber-400">Student No</span> login tab with your
              Registration Number and National ID.
            </div>
          )}
        </div>
      ) : effectiveRole === 'applicant' ? (
        /* 2. PROSPECTIVE APPLICANT VIEW */
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">My Applications</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {data.applications.length}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Real-time status tracking</p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Under Review / Submitted</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {pendingApps}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Awaiting Admissions Senate</p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Admission Offers</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {data.applications.filter((a) => a.status === 'admitted').length}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Ready for registration</p>
            </div>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Live Application Tracker
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('admissions')}
                className="text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline"
              >
                Open Admissions Portal
              </button>
            </div>
            {data.applications.length === 0 ? (
              <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                You have not submitted an admission application yet. Click &ldquo;Open Admissions Portal&rdquo; to apply.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.applications.map((app) => (
                  <div key={app.id} className="p-5 flex flex-wrap items-center justify-between gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {app.programmeName || app.programmeId}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {app.entryCategory} · {app.intake || '2026/2027'} · Paybill Ref:{' '}
                        <span className="font-mono">{app.appFeePaybillRef}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-xs font-semibold uppercase ${
                          app.status === 'admitted'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : app.status === 'rejected'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {app.status.replace('_', ' ')}
                      </span>
                      {app.status === 'admitted' && (
                        <button
                          type="button"
                          onClick={() => generateAdmissionLetterPDF(app)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Admission Letter</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : isAcademicRole ? (
        /* 3. LECTURER / HOD / EXAM OFFICER VIEW (NO FINANCE/HR PAYROLL DATA) */
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Academic Course Units</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {data.courses.length}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Active Curriculum</p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Unit Enrollments</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {data.registrations.filter((r) => r.status === 'registered').length}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{totalStudents} Students</p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Marks Awaiting Moderation / Publish</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {data.examMarks.filter((m) => m.workflowStatus !== 'published').length}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {data.examMarks.filter((m) => m.workflowStatus === 'published').length} Published
              </p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Attendance Sessions</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {data.attendanceSessions.length}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Logged Lecture Rolls</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('academics')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              <span>Open Marks &amp; Attendance</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('resources')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 hover:border-amber-500"
            >
              <span>Upload Books, Online Classes &amp; CATs</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('services')}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 hover:border-amber-500"
            >
              <span>Publish Academic Circular</span>
            </button>
          </div>
        </div>
      ) : (
        /* 4. EXECUTIVE / ADMIN / FINANCE / ADMISSIONS / HR VIEW */
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Enrolled Students</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {totalStudents}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {activeStudents} Active · {pendingApps} Pending Apps
              </p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Verified Collections</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatKes(totalCollected)}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">Billed {formatKes(totalBilled)}</p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Pending Paybill / Bank Queue</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {pendingPayments.length}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {formatKes(pendingPaymentsSum)} Awaiting Verification
              </p>
            </div>
            <div className="p-5 space-y-1">
              <p className="text-xs text-slate-500 dark:text-slate-400">Active Staff &amp; Gross Pool</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                {activeEmployees}
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400">{formatKes(monthlyBasicPool)} / mo</p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Tuition Billing, Collections &amp; Outstanding Balances
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Computed strictly from verified Firestore student accounts
                  </p>
                </div>
                {['super_admin', 'management', 'finance'].includes(effectiveRole) && (
                  <button
                    type="button"
                    onClick={() => onNavigate('finance')}
                    className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap"
                  >
                    Open Finance Ledger
                  </button>
                )}
              </div>
              <div className="h-64">
                <Bar
                  data={financeChartData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { ticks: { color: tickColor }, grid: { display: false } },
                      y: { ticks: { color: tickColor }, grid: { color: gridColor } },
                    },
                  }}
                />
              </div>
            </div>

            <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Enrollment by Programme</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Live student headcount distribution</p>
              </div>
              <div className="h-52 flex items-center justify-center">
                <Doughnut
                  data={enrollmentDoughnutData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'bottom',
                        labels: { color: tickColor, boxWidth: 12, padding: 14 },
                      },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Verified Collection Channels
                </h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">KES Totals</span>
              </div>
              <table className="w-full text-left text-sm">
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {channels.map((ch, idx) => (
                    <tr key={ch}>
                      <td className="py-3 px-5 font-medium text-slate-800 dark:text-slate-200">{ch}</td>
                      <td className="py-3 px-5 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                        {formatKes(channelTotals[idx])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="lg:col-span-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Priority Action Queues</h3>
              <div className="space-y-3 text-sm">
                {['super_admin', 'management', 'finance'].includes(effectiveRole) && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-slate-600 dark:text-slate-300">Paybill / Bank Verifications</span>
                    <button
                      type="button"
                      onClick={() => onNavigate('finance')}
                      className="font-mono font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      {pendingPayments.length} pending
                    </button>
                  </div>
                )}
                {['super_admin', 'management', 'admissions'].includes(effectiveRole) && (
                  <div className="flex items-center justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-slate-600 dark:text-slate-300">Admission Applications</span>
                    <button
                      type="button"
                      onClick={() => onNavigate('admissions')}
                      className="font-mono font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      {pendingApps} to review
                    </button>
                  </div>
                )}
                {['super_admin', 'management', 'hr'].includes(effectiveRole) && (
                  <div className="flex items-center justify-between py-2">
                    <span className="text-slate-600 dark:text-slate-300">Staff Leave Requests</span>
                    <button
                      type="button"
                      onClick={() => onNavigate('hr')}
                      className="font-mono font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                    >
                      {data.leaveRequests.filter((l) => l.status === 'pending').length} pending
                    </button>
                  </div>
                )}
              </div>
              <div className="pt-1 flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>All figures live-synced from Firestore</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
