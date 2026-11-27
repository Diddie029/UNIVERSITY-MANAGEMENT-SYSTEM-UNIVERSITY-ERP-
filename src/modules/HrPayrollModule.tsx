import React, { useEffect, useState } from 'react';
import { collection, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { Calculator, CheckCircle2, Download, FileSpreadsheet, Plus, Settings2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, hashVerificationKey, makeId, OperationType, sanitizeId } from '../lib/firebase';
import {
  generateMonthlyPayrollRun,
  recordAuditLog,
  transitionPayrollRunStatus,
} from '../lib/erpService';
import { DEFAULT_STATUTORY_CONFIG, formatKes } from '../lib/kenyaEngine';
import { exportToCSV, generatePayslipPDF } from '../lib/pdfGenerator';
import { Employee, Payslip, ROLE_LABELS, StatutoryConfig, UserRole } from '../types/erp';

interface HrPayrollModuleProps {
  data: ErpDataset;
}

export function HrPayrollModule({ data }: HrPayrollModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { showToast } = useToast();

  const isHrStaff = ['super_admin', 'admin', 'management', 'hr'].includes(effectiveRole);
  const canApprovePayroll = ['super_admin', 'admin', 'management', 'finance'].includes(effectiveRole);

  const [tab, setTab] = useState<'payroll' | 'employees' | 'leave' | 'statutory'>('payroll');
  const [monthLabel, setMonthLabel] = useState('November 2026');
  const [runningPayroll, setRunningPayroll] = useState(false);

  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [payslips, setPayslips] = useState<Payslip[]>([]);

  // Employee Form
  const [showEmpForm, setShowEmpForm] = useState(false);
  const [staffNo, setStaffNo] = useState('');
  const [empName, setEmpName] = useState('');
  const [empEmail, setEmpEmail] = useState('');
  const [empDeptId, setEmpDeptId] = useState('');
  const [empTitle, setEmpTitle] = useState('');
  const [empCat, setEmpCat] = useState<Employee['employmentCategory']>('Permanent');
  const [empBasic, setEmpBasic] = useState('95000');
  const [empHouse, setEmpHouse] = useState('25000');
  const [empCommuter, setEmpCommuter] = useState('10000');
  const [empPension, setEmpPension] = useState('7500');
  const [empKra, setEmpKra] = useState('A00');
  const [empBank, setEmpBank] = useState('KCB Bank');
  const [empPortalRole, setEmpPortalRole] = useState<Exclude<UserRole, 'super_admin' | 'applicant' | 'student'>>('lecturer');
  const [empPasscode, setEmpPasscode] = useState('');

  // Leave Form
  const [leaveEmpId, setLeaveEmpId] = useState('');
  const [leaveType, setLeaveType] = useState<'Annual' | 'Sick' | 'Maternity/Paternity' | 'Study' | 'Compassionate'>('Annual');
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveDays, setLeaveDays] = useState('5');
  const [leaveReason, setLeaveReason] = useState('');

  // Statutory Config State
  const currentConfig: StatutoryConfig = data.statutoryConfigs[0] ?? {
    id: 'kenya_default',
    ...DEFAULT_STATUTORY_CONFIG,
    updatedAt: new Date().toISOString(),
  };

  const [shifRate, setShifRate] = useState(String(currentConfig.shifRate));
  const [housingRate, setHousingRate] = useState(String(currentConfig.housingLevyRate));
  const [nssfRate, setNssfRate] = useState(String(currentConfig.nssfRate));
  const [personalRelief, setPersonalRelief] = useState(String(currentConfig.personalRelief));

  useEffect(() => {
    if (data.statutoryConfigs[0]) {
      setShifRate(String(data.statutoryConfigs[0].shifRate));
      setHousingRate(String(data.statutoryConfigs[0].housingLevyRate));
      setNssfRate(String(data.statutoryConfigs[0].nssfRate));
      setPersonalRelief(String(data.statutoryConfigs[0].personalRelief));
    }
  }, [data.statutoryConfigs]);

  const activeRunId = selectedRunId || data.payrollRuns[0]?.id || '';
  const activeRun = data.payrollRuns.find((r) => r.id === activeRunId);

  useEffect(() => {
    if (!activeRunId) {
      setPayslips([]);
      return;
    }
    getDocs(collection(db, 'payroll_runs', activeRunId, 'payslips'))
      .then((snap) => {
        setPayslips(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Payslip, 'id'>) })));
      })
      .catch((err) => handleFirestoreError(err, OperationType.LIST, `payroll_runs/${activeRunId}/payslips`));
  }, [activeRunId, data.payrollRuns]);

  const handleRunPayroll = async () => {
    if (!firebaseUser || !profile) return;
    setRunningPayroll(true);
    try {
      const runId = await generateMonthlyPayrollRun(monthLabel, data.employees, currentConfig, {
        uid: firebaseUser.uid,
        name: profile.displayName,
        role: profile.role,
      });
      setSelectedRunId(runId);
      showToast(`Generated ${monthLabel} Kenyan statutory payroll draft.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Payroll generation failed.', 'error');
    } finally {
      setRunningPayroll(false);
    }
  };

  const handleTransitionPayroll = async (nextStatus: 'approved' | 'paid') => {
    if (!activeRun || !firebaseUser || !profile) return;
    try {
      await transitionPayrollRunStatus(activeRun.id, activeRun.monthLabel, nextStatus, {
        uid: firebaseUser.uid,
        name: profile.displayName,
        role: profile.role,
      });
      showToast(`Payroll batch ${activeRun.monthLabel} marked as ${nextStatus}.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update payroll status.', 'error');
    }
  };

  const handleCreateEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const dept = data.departments.find((d) => d.id === (empDeptId || data.departments[0]?.id));
    if (!dept) {
      showToast('Select a valid department.', 'error');
      return;
    }
    const empId = makeId('emp');
    const now = new Date().toISOString();
    const cleanStaffNo = clampStr(staffNo.toUpperCase(), 48);
    const bindingSecret = empPasscode.trim() || cleanStaffNo.replace(/[^A-Z0-9]/g, '').slice(-6);
    try {
      await setDoc(doc(db, 'employees', empId), {
        staffNo: cleanStaffNo,
        uid: '',
        fullName: clampStr(empName, 160),
        email: clampStr(empEmail.toLowerCase(), 200),
        departmentId: dept.id,
        departmentName: dept.name,
        jobTitle: clampStr(empTitle, 120),
        employmentCategory: empCat,
        basicSalary: Number(empBasic) || 0,
        houseAllowance: Number(empHouse) || 0,
        commuterAllowance: Number(empCommuter) || 0,
        pensionContribution: Number(empPension) || 0,
        kraPin: clampStr(empKra.toUpperCase(), 24),
        bankName: clampStr(empBank, 80),
        bankAccountMasked: '****' + Math.floor(1000 + Math.random() * 9000),
        status: 'Active',
        createdAt: now,
        updatedAt: now,
      });
      const verificationHash = await hashVerificationKey(bindingSecret);
      await setDoc(doc(db, 'portal_bindings', sanitizeId(cleanStaffNo)), {
        code: cleanStaffNo,
        targetType: 'employee',
        targetId: empId,
        role: empPortalRole,
        fullName: clampStr(empName, 160),
        verificationHash,
        boundUid: '',
        createdAt: now,
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'EMPLOYEE_REGISTERED',
        `employees/${empId}`,
        `Onboarded ${empName} (${cleanStaffNo}) as ${empTitle} with portal role ${empPortalRole}.`
      );
      showToast(`Registered ${empName}. Staff Login ID: ${cleanStaffNo} (Passcode: ${bindingSecret}).`, 'success');
      setShowEmpForm(false);
      setStaffNo('');
      setEmpName('');
      setEmpEmail('');
      setEmpTitle('');
      setEmpPasscode('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `employees/${empId}`);
    }
  };

  const handleSubmitLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    const emp = data.employees.find((em) => em.id === (leaveEmpId || data.employees[0]?.id));
    if (!emp) return;
    const leaveId = makeId('lev');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'leave_requests', leaveId), {
        employeeId: emp.id,
        employeeUid: emp.uid || firebaseUser?.uid || '',
        staffNo: emp.staffNo,
        employeeName: emp.fullName,
        leaveType,
        startDate: leaveStart,
        endDate: leaveEnd,
        days: Number(leaveDays) || 1,
        reason: clampStr(leaveReason, 400),
        status: 'pending',
        reviewedBy: '',
        createdAt: now,
        updatedAt: now,
      });
      showToast('Leave request submitted to HR.', 'success');
      setLeaveReason('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `leave_requests/${leaveId}`);
    }
  };

  const handleLeaveAction = async (leaveId: string, status: 'approved' | 'rejected') => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'leave_requests', leaveId), {
        status,
        reviewedBy: clampStr(profile.displayName, 128),
        updatedAt: new Date().toISOString(),
      });
      showToast(`Leave request ${status}.`, status === 'approved' ? 'success' : 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `leave_requests/${leaveId}`);
    }
  };

  const handleSaveStatutoryConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const cfgId = data.statutoryConfigs[0]?.id || 'kenya_default';
    try {
      await setDoc(doc(db, 'statutory_configs', cfgId), {
        ...currentConfig,
        shifRate: Number(shifRate),
        housingLevyRate: Number(housingRate),
        nssfRate: Number(nssfRate),
        personalRelief: Number(personalRelief),
        updatedBy: clampStr(profile.displayName, 128),
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STATUTORY_CONFIG_UPDATED',
        `statutory_configs/${cfgId}`,
        `Updated Kenyan statutory rates: SHIF ${shifRate}%, Housing Levy ${housingRate}%, NSSF ${nssfRate}%, Relief KES ${personalRelief}.`
      );
      showToast('Kenyan statutory rates updated.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `statutory_configs/${cfgId}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Human Resources &amp; Kenyan Statutory Payroll
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            PAYE · NSSF Tier I &amp; II · SHIF (2.75%) · Affordable Housing Levy (1.5%) · Leave &amp; Bank Remittance
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {(['payroll', 'employees', 'leave', 'statutory'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                tab === t
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t === 'statutory' ? 'Tax & Rates' : t === 'leave' ? 'Leave Workflow' : t}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: Payroll Engine */}
      {tab === 'payroll' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5">
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={monthLabel}
                onChange={(e) => setMonthLabel(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
              {isHrStaff && (
                <button
                  type="button"
                  disabled={runningPayroll}
                  onClick={handleRunPayroll}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                >
                  <Calculator className="w-4 h-4" />
                  <span>{runningPayroll ? 'Computing...' : 'Run Monthly Payroll'}</span>
                </button>
              )}
            </div>

            {activeRun && (
              <div className="flex flex-wrap items-center gap-2">
                {canApprovePayroll && activeRun.status === 'draft' && (
                  <button
                    type="button"
                    onClick={() => handleTransitionPayroll('approved')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve Batch</span>
                  </button>
                )}
                {canApprovePayroll && activeRun.status === 'approved' && (
                  <button
                    type="button"
                    onClick={() => handleTransitionPayroll('paid')}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    Authorize Bank Disbursement
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    exportToCSV(
                      `EDUVANCE_Bank_Schedule_${activeRun.monthLabel.replace(/\s+/g, '_')}.csv`,
                      ['Staff No', 'Employee Name', 'Bank', 'Account', 'Gross Pay', 'NSSF', 'SHIF', 'Housing Levy', 'PAYE', 'Net Pay'],
                      payslips.map((s) => [
                        s.staffNo,
                        s.employeeName,
                        s.bankName || '',
                        s.bankAccountMasked || '',
                        s.grossPay,
                        s.nssf,
                        s.shif,
                        s.housingLevy,
                        s.paye,
                        s.netPay,
                      ])
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-amber-500" />
                  <span>Bank Schedule CSV</span>
                </button>
              </div>
            )}
          </div>

          {data.payrollRuns.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.payrollRuns.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedRunId(run.id)}
                  className={`px-3.5 py-2 text-xs rounded-lg border text-left transition-colors ${
                    run.id === activeRunId
                      ? 'border-amber-500 bg-amber-500/10 text-slate-900 dark:text-white'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <span className="font-semibold block">{run.monthLabel}</span>
                  <span className="font-mono text-[11px] uppercase">{run.status} · {run.employeeCount} staff</span>
                </button>
              ))}
            </div>
          )}

          {activeRun && (
            <div className="grid grid-cols-2 lg:grid-cols-5 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
              <div className="p-4">
                <p className="text-xs text-slate-500">Gross Payroll</p>
                <p className="text-lg font-bold font-mono tabular-nums">{formatKes(activeRun.totalGross)}</p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">Total PAYE</p>
                <p className="text-lg font-bold font-mono tabular-nums">{formatKes(activeRun.totalPaye)}</p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">Total NSSF</p>
                <p className="text-lg font-bold font-mono tabular-nums">{formatKes(activeRun.totalNssf)}</p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">SHIF + Housing</p>
                <p className="text-lg font-bold font-mono tabular-nums">
                  {formatKes(activeRun.totalShif + activeRun.totalHousingLevy)}
                </p>
              </div>
              <div className="p-4">
                <p className="text-xs text-slate-500">Net Disbursement</p>
                <p className="text-lg font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                  {formatKes(activeRun.totalNetPay)}
                </p>
              </div>
            </div>
          )}

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Staff</th>
                  <th className="py-3 px-4 font-medium text-right">Gross Pay</th>
                  <th className="py-3 px-4 font-medium text-right">NSSF</th>
                  <th className="py-3 px-4 font-medium text-right">SHIF</th>
                  <th className="py-3 px-4 font-medium text-right">Housing</th>
                  <th className="py-3 px-4 font-medium text-right">PAYE</th>
                  <th className="py-3 px-4 font-medium text-right">Net Pay</th>
                  <th className="py-3 px-4 font-medium text-right">Payslip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {payslips.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                      Click "Run Monthly Payroll" to compute Kenyan statutory deductions and generate payslips.
                    </td>
                  </tr>
                ) : (
                  payslips.map((slip) => (
                    <tr key={slip.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4">
                        <p className="font-medium">{slip.employeeName}</p>
                        <p className="text-xs font-mono text-slate-500">{slip.staffNo}</p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(slip.grossPay)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(slip.nssf)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(slip.shif)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(slip.housingLevy)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(slip.paye)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-emerald-600 dark:text-emerald-400">
                        {formatKes(slip.netPay)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => generatePayslipPDF(slip)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: Employee Directory */}
      {tab === 'employees' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">University Staff Directory ({data.employees.length})</h3>
            {isHrStaff && (
              <button
                type="button"
                onClick={() => setShowEmpForm((p) => !p)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showEmpForm ? 'Close' : 'Add Employee'}</span>
              </button>
            )}
          </div>

          {showEmpForm && isHrStaff && (
            <form
              onSubmit={handleCreateEmployee}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 grid grid-cols-1 sm:grid-cols-3 gap-4"
            >
              <input type="text" required placeholder="Staff No (EDU-STF-0301)" value={staffNo} onChange={(e) => setStaffNo(e.target.value)} className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="text" required placeholder="Full Name" value={empName} onChange={(e) => setEmpName(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="email" required placeholder="Official Email" value={empEmail} onChange={(e) => setEmpEmail(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <select value={empDeptId || data.departments[0]?.id || ''} onChange={(e) => setEmpDeptId(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <input type="text" required placeholder="Job Title" value={empTitle} onChange={(e) => setEmpTitle(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <select value={empCat} onChange={(e) => setEmpCat(e.target.value as Employee['employmentCategory'])} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                <option value="Permanent">Permanent</option>
                <option value="Contract">Contract</option>
                <option value="Part-Time">Part-Time</option>
                <option value="Temporary">Temporary</option>
              </select>
              <input type="number" required placeholder="Basic Salary" value={empBasic} onChange={(e) => setEmpBasic(e.target.value)} className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="number" placeholder="House Allowance" value={empHouse} onChange={(e) => setEmpHouse(e.target.value)} className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="number" placeholder="Commuter Allowance" value={empCommuter} onChange={(e) => setEmpCommuter(e.target.value)} className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="number" placeholder="Pension" value={empPension} onChange={(e) => setEmpPension(e.target.value)} className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="text" placeholder="KRA PIN" value={empKra} onChange={(e) => setEmpKra(e.target.value)} className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="text" placeholder="Bank Name" value={empBank} onChange={(e) => setEmpBank(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <select
                value={empPortalRole}
                onChange={(e) => setEmpPortalRole(e.target.value as Exclude<UserRole, 'super_admin' | 'applicant' | 'student'>)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {(['lecturer', 'hod', 'exam_officer', 'finance', 'hr', 'admissions', 'admin', 'management'] as const).map((r) => (
                  <option key={r} value={r}>Portal Role: {ROLE_LABELS[r]}</option>
                ))}
              </select>
              <input type="text" placeholder="Staff Login Passcode (optional)" value={empPasscode} onChange={(e) => setEmpPasscode(e.target.value)} className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <div className="sm:col-span-3 flex justify-end">
                <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
                  Save Staff Profile &amp; Issue Staff Login
                </button>
              </div>
            </form>
          )}

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Staff No</th>
                  <th className="py-3 px-4 font-medium">Name &amp; Title</th>
                  <th className="py-3 px-4 font-medium">Category</th>
                  <th className="py-3 px-4 font-medium text-right">Basic Salary</th>
                  <th className="py-3 px-4 font-medium text-right">Allowances</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.employees.map((e) => (
                  <tr key={e.id}>
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">
                      {e.staffNo}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium">{e.fullName}</p>
                      <p className="text-xs text-slate-500">{e.jobTitle} · {e.departmentName}</p>
                    </td>
                    <td className="py-3 px-4 text-xs">{e.employmentCategory}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">{formatKes(e.basicSalary)}</td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      {formatKes((e.houseAllowance || 0) + (e.commuterAllowance || 0))}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {e.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Leave Management */}
      {tab === 'leave' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={handleSubmitLeave}
            className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4 self-start"
          >
            <h3 className="text-sm font-semibold">Apply for Staff Leave</h3>
            <select
              value={leaveEmpId || data.employees[0]?.id || ''}
              onChange={(e) => setLeaveEmpId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              {data.employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.staffNo} — {e.fullName}
                </option>
              ))}
            </select>
            <select
              value={leaveType}
              onChange={(e) => setLeaveType(e.target.value as 'Annual' | 'Sick' | 'Maternity/Paternity' | 'Study' | 'Compassionate')}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              {['Annual', 'Sick', 'Maternity/Paternity', 'Study', 'Compassionate'].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input type="date" required value={leaveStart} onChange={(e) => setLeaveStart(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
              <input type="date" required value={leaveEnd} onChange={(e) => setLeaveEnd(e.target.value)} className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
            </div>
            <input type="number" min={1} required value={leaveDays} onChange={(e) => setLeaveDays(e.target.value)} placeholder="Working days" className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
            <textarea rows={2} required value={leaveReason} onChange={(e) => setLeaveReason(e.target.value)} placeholder="Leave handover details..." className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
            <button type="submit" className="w-full px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
              Submit Leave Request
            </button>
          </form>

          <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Employee</th>
                  <th className="py-3 px-4 font-medium">Type &amp; Dates</th>
                  <th className="py-3 px-4 font-medium">Status</th>
                  <th className="py-3 px-4 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.leaveRequests.map((lr) => (
                  <tr key={lr.id}>
                    <td className="py-3 px-4">
                      <p className="font-medium">{lr.employeeName}</p>
                      <p className="text-xs font-mono text-slate-500">{lr.staffNo}</p>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <span className="font-semibold">{lr.leaveType}</span> ({lr.days} days)
                      <span className="block text-slate-500">{lr.startDate} to {lr.endDate}</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold capitalize">{lr.status}</td>
                    <td className="py-3 px-4 text-right space-x-2">
                      {isHrStaff && lr.status === 'pending' && (
                        <>
                          <button type="button" onClick={() => handleLeaveAction(lr.id, 'approved')} className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 text-white">Approve</button>
                          <button type="button" onClick={() => handleLeaveAction(lr.id, 'rejected')} className="px-2.5 py-1 text-xs font-medium rounded border border-red-500/40 text-red-500">Reject</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: Configurable Kenyan Statutory Rates */}
      {tab === 'statutory' && (
        <form
          onSubmit={handleSaveStatutoryConfig}
          className="max-w-2xl border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Kenyan Statutory Tax &amp; Deduction Parameters</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">SHIF Rate (%)</label>
              <input type="number" step="0.01" value={shifRate} onChange={(e) => setShifRate(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Affordable Housing Levy (%)</label>
              <input type="number" step="0.01" value={housingRate} onChange={(e) => setHousingRate(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">NSSF Rate (%)</label>
              <input type="number" step="0.01" value={nssfRate} onChange={(e) => setNssfRate(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Monthly Personal Relief (KES)</label>
              <input type="number" value={personalRelief} onChange={(e) => setPersonalRelief(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
            </div>
          </div>
          {isHrStaff && (
            <button type="submit" className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
              Save Statutory Configuration
            </button>
          )}
        </form>
      )}
    </div>
  );
}
