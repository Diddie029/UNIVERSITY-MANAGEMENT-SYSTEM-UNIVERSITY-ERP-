import React, { useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { CheckCircle2, Download, Plus, Search, XCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { approveAdmissionApplication, recordAuditLog } from '../lib/erpService';
import { generateAdmissionLetterPDF } from '../lib/pdfGenerator';
import { AdmissionApplication } from '../types/erp';

interface AdmissionsModuleProps {
  data: ErpDataset;
}

export function AdmissionsModule({ data }: AdmissionsModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { showToast } = useToast();

  const canReview = ['super_admin', 'management', 'admissions'].includes(effectiveRole);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showNewForm, setShowNewForm] = useState(false);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [kcseIndex, setKcseIndex] = useState('');
  const [kcseMeanGrade, setKcseMeanGrade] = useState('B+');
  const [programmeId, setProgrammeId] = useState('');
  const [entryCategory, setEntryCategory] = useState<'KUCCPS' | 'Self-Sponsored'>('Self-Sponsored');
  const [intake, setIntake] = useState('January 2027');
  const [appFeePaybillRef, setAppFeePaybillRef] = useState('');
  const [saving, setSaving] = useState(false);

  const [approveTarget, setApproveTarget] = useState<AdmissionApplication | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdmissionApplication | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [processing, setProcessing] = useState(false);

  const filtered = data.applications.filter((app) => {
    const matchesSearch =
      !search.trim() ||
      app.fullName.toLowerCase().includes(search.toLowerCase()) ||
      app.nationalId.toLowerCase().includes(search.toLowerCase()) ||
      (app.generatedAdmissionNo || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const handleCreateApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;
    const chosenProg = data.programmes.find((p) => p.id === (programmeId || data.programmes[0]?.id));
    if (!chosenProg) {
      showToast('Select a valid programme first.', 'error');
      return;
    }

    setSaving(true);
    const appId = makeId('app');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'applications', appId), {
        applicantUid: firebaseUser.uid,
        fullName: clampStr(fullName, 160),
        email: clampStr(email || firebaseUser.email || '', 200),
        phone: clampStr(phone, 32),
        nationalId: clampStr(nationalId, 32),
        kcseIndex: clampStr(kcseIndex, 32),
        kcseMeanGrade: clampStr(kcseMeanGrade, 8),
        programmeId: chosenProg.id,
        programmeName: clampStr(chosenProg.name, 180),
        entryCategory,
        intake: clampStr(intake, 64),
        appFeePaybillRef: clampStr(appFeePaybillRef.toUpperCase(), 32),
        status: 'submitted',
        generatedAdmissionNo: '',
        reviewNotes: '',
        reviewedBy: '',
        createdAt: now,
        updatedAt: now,
      });
      showToast('Application submitted successfully.', 'success');
      setShowNewForm(false);
      setFullName('');
      setPhone('');
      setNationalId('');
      setKcseIndex('');
      setAppFeePaybillRef('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `applications/${appId}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmApprove = async () => {
    if (!approveTarget || !firebaseUser || !profile) return;
    const prog = data.programmes.find((p) => p.id === approveTarget.programmeId);
    const dept = data.departments.find((d) => d.id === prog?.departmentId);
    setProcessing(true);
    try {
      const admNo = await approveAdmissionApplication(
        approveTarget,
        prog?.code || 'GEN',
        dept?.id || '',
        dept?.facultyId || '',
        data.feeStructures,
        data.students.length,
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role }
      );
      showToast(`Admitted ${approveTarget.fullName} with Admission No ${admNo}.`, 'success');
      setApproveTarget(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Approval failed.', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleConfirmReject = async () => {
    if (!rejectTarget || !firebaseUser || !profile) return;
    if (rejectNotes.trim().length < 4) {
      showToast('Enter a rejection reason (minimum 4 characters).', 'error');
      return;
    }
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'applications', rejectTarget.id), {
        status: 'rejected',
        reviewNotes: clampStr(rejectNotes, 500),
        reviewedBy: clampStr(profile.displayName, 128),
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'ADMISSION_REJECTED',
        `applications/${rejectTarget.id}`,
        `Rejected application for ${rejectTarget.fullName}: ${rejectNotes}`
      );
      showToast('Application marked as rejected.', 'info');
      setRejectTarget(null);
      setRejectNotes('');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `applications/${rejectTarget.id}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">Admissions &amp; Applications</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Review KCSE qualifications, approve admission offers, issue admission numbers, and download Senate letters.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewForm((prev) => !prev)}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>{showNewForm ? 'Close Form' : 'New Application'}</span>
        </button>
      </div>

      {showNewForm && (
        <form
          onSubmit={handleCreateApplication}
          className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Applicant Email</label>
            <input
              type="email"
              required
              value={email || firebaseUser?.email || ''}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Phone Number</label>
            <input
              type="tel"
              required
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+2547..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">National ID</label>
            <input
              type="text"
              required
              value={nationalId}
              onChange={(e) => setNationalId(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">KCSE Index &amp; Grade</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={kcseIndex}
                onChange={(e) => setKcseIndex(e.target.value)}
                placeholder="20401002/019"
                className="flex-1 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
              <select
                value={kcseMeanGrade}
                onChange={(e) => setKcseMeanGrade(e.target.value)}
                className="w-20 px-2 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'].map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Programme</label>
            <select
              value={programmeId || data.programmes[0]?.id || ''}
              onChange={(e) => setProgrammeId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              {data.programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Category</label>
            <select
              value={entryCategory}
              onChange={(e) => setEntryCategory(e.target.value as 'KUCCPS' | 'Self-Sponsored')}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="Self-Sponsored">Self-Sponsored</option>
              <option value="KUCCPS">KUCCPS</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Intake</label>
            <input
              type="text"
              value={intake}
              onChange={(e) => setIntake(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">App Fee Paybill Ref</label>
            <input
              type="text"
              required
              value={appFeePaybillRef}
              onChange={(e) => setAppFeePaybillRef(e.target.value)}
              placeholder="UCK9P2X4L1"
              className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowNewForm(false)}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Submit Application'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ID, or admission no..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]"
          />
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {['all', 'submitted', 'admitted', 'rejected'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Applications Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-3 px-4 font-medium">Applicant</th>
              <th className="py-3 px-4 font-medium">Programme &amp; Intake</th>
              <th className="py-3 px-4 font-medium">KCSE</th>
              <th className="py-3 px-4 font-medium">Paybill Ref</th>
              <th className="py-3 px-4 font-medium">Status / Admission No</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  No applications match the current filter.
                </td>
              </tr>
            ) : (
              filtered.map((app) => (
                <tr key={app.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4">
                    <p className="font-medium text-slate-900 dark:text-slate-100">{app.fullName}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      ID {app.nationalId} · {app.phone}
                    </p>
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-slate-800 dark:text-slate-200">{app.programmeName || app.programmeId}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {app.entryCategory} · {app.intake || '2026/2027'}
                    </p>
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900 dark:text-white">
                    {app.kcseMeanGrade}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-300">
                    {app.appFeePaybillRef}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={`text-xs font-semibold capitalize ${
                        app.status === 'admitted'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : app.status === 'rejected'
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {app.status.replace('_', ' ')}
                    </span>
                    {app.generatedAdmissionNo && (
                      <p className="text-xs font-mono text-slate-600 dark:text-slate-300">
                        {app.generatedAdmissionNo}
                      </p>
                    )}
                    {app.reviewNotes && app.status === 'rejected' && (
                      <p className="text-xs text-red-500 dark:text-red-400">{app.reviewNotes}</p>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                    {app.status === 'admitted' && (
                      <button
                        type="button"
                        onClick={() => generateAdmissionLetterPDF(app)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Admission Letter</span>
                      </button>
                    )}
                    {canReview && (app.status === 'submitted' || app.status === 'under_review') && (
                      <>
                        <button
                          type="button"
                          onClick={() => setApproveTarget(app)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Admit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectTarget(app)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          <span>Reject</span>
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={Boolean(approveTarget)}
        title="Approve Admission & Bill Semester I Fees"
        description={
          approveTarget
            ? `Admitting ${approveTarget.fullName} into ${approveTarget.programmeName} will generate a unique Admission Number, create their Student Profile, and bill Semester I fees.`
            : ''
        }
        confirmLabel="Approve & Admit Student"
        loading={processing}
        onConfirm={handleConfirmApprove}
        onCancel={() => setApproveTarget(null)}
      />

      {rejectTarget && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">
              Reject Application — {rejectTarget.fullName}
            </h3>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Official Rejection Reason
              </label>
              <textarea
                rows={3}
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="e.g. Does not meet minimum KCSE cluster grade requirement."
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setRejectTarget(null);
                  setRejectNotes('');
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={processing}
                onClick={handleConfirmReject}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-red-600 hover:bg-red-500 text-white"
              >
                {processing ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
