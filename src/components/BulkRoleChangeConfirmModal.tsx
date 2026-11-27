import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ShieldAlert, Users, X } from 'lucide-react';
import { ROLE_LABELS, UserProfile, UserRole } from '../types/erp';

const ROLE_SCOPE_DESCRIPTIONS: Record<UserRole, string> = {
  super_admin: 'Full institutional authority across Governance, curriculum, user role assignment, finance, HR, and system health.',
  admin: 'Operational admin access across Admissions, Academics, Resources, Finance, HR, Services, and read-only Governance.',
  management: 'University executive management access across all operational modules and read-only Governance.',
  admissions: 'Review applications, admit students, and manage student intake status.',
  lecturer: 'Manage assigned courses, online classes, attendance QR sessions, assignments, CATs, and draft exam marks.',
  hod: 'Departmental academic oversight, marks moderation, and timetable/resource supervision.',
  exam_officer: 'Moderate, approve, and publish official student examination marks and timetables.',
  finance: 'Verify payments, issue receipts, manage fee structures, and disburse scholarships.',
  hr: 'Manage employee profiles, approve leave requests, and run statutory payroll batches.',
  student: 'Access student registration, exam timetable, grade trends, e-resources, online exams, and fee statements.',
  applicant: 'Submit and track prospective student admission applications.',
};

export interface BulkRoleTargetItem {
  user: UserProfile;
  identifier?: string;
  departmentName?: string;
}

interface BulkRoleChangeConfirmModalProps {
  open: boolean;
  targets: BulkRoleTargetItem[];
  nextRole: UserRole | null;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function BulkRoleChangeConfirmModal({
  open,
  targets,
  nextRole,
  loading = false,
  onConfirm,
  onCancel,
}: BulkRoleChangeConfirmModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [reason, setReason] = useState('');

  const usersToUpdate = nextRole ? targets.filter((t) => t.user.role !== nextRole) : [];
  const alreadyAtTargetCount = targets.length - usersToUpdate.length;

  const isPrivilegedTransition =
    nextRole === 'super_admin' ||
    nextRole === 'admin' ||
    usersToUpdate.some((t) => t.user.role === 'super_admin');

  const requiresTypedConfirmation =
    nextRole === 'super_admin' || usersToUpdate.some((t) => t.user.role === 'super_admin');

  useEffect(() => {
    setAcknowledged(false);
    setPhraseInput('');
    setReason('');
  }, [open, nextRole, targets.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open || !nextRole || usersToUpdate.length === 0) return null;

  const canSubmit =
    !loading &&
    acknowledged &&
    (!requiresTypedConfirmation || phraseInput.trim().toUpperCase() === 'CONFIRM');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-role-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="flex items-start gap-3">
            <div
              className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${
                requiresTypedConfirmation
                  ? 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
                  : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'
              }`}
            >
              {requiresTypedConfirmation ? (
                <ShieldAlert className="w-4 h-4" />
              ) : (
                <AlertTriangle className="w-4 h-4" />
              )}
            </div>
            <div>
              <h3 id="bulk-role-confirm-title" className="text-base font-bold text-slate-900 dark:text-white">
                Confirm Bulk Role Assignment ({usersToUpdate.length}{' '}
                {usersToUpdate.length === 1 ? 'User' : 'Users'})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Review all selected accounts before applying simultaneous role updates.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            aria-label="Close bulk confirmation dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onConfirm(reason.trim());
          }}
          className="p-6 space-y-5 overflow-y-auto"
        >
          {/* Target Role Summary */}
          <div
            className={`rounded-lg border p-4 space-y-1.5 ${
              requiresTypedConfirmation
                ? 'border-red-500/40 bg-red-500/5'
                : 'border-amber-500/40 bg-amber-500/5'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                Target System Role
              </span>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                {usersToUpdate.length} account{usersToUpdate.length === 1 ? '' : 's'} to update
                {alreadyAtTargetCount > 0 ? ` · ${alreadyAtTargetCount} unchanged` : ''}
              </span>
            </div>
            <p
              className={`text-sm font-bold ${
                requiresTypedConfirmation
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {ROLE_LABELS[nextRole]} ({nextRole})
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              {ROLE_SCOPE_DESCRIPTIONS[nextRole]}
            </p>
            {isPrivilegedTransition && (
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium pt-1">
                High-privilege transition: changes take effect immediately across Firestore rules and are logged individually in Audit Logs.
              </p>
            )}
          </div>

          {/* Affected Accounts List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                <Users className="w-3.5 h-3.5 text-amber-500" />
                <span>Affected Accounts</span>
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                {usersToUpdate.length} selected
              </span>
            </div>

            <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800 bg-slate-50/60 dark:bg-slate-900/50">
              {usersToUpdate.map(({ user, identifier, departmentName }) => (
                <div
                  key={user.id}
                  className="px-3.5 py-2.5 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {user.displayName}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      <span className="font-mono">{identifier || user.uid.slice(0, 12)}</span>
                      {departmentName && (
                        <>
                          {' '}
                          · <span>{departmentName}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400">{ROLE_LABELS[user.role]}</span>
                    <ArrowRight className="w-3 h-3 text-slate-400" />
                    <span
                      className={`font-semibold ${
                        requiresTypedConfirmation
                          ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {ROLE_LABELS[nextRole]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Audit Reason */}
          <div>
            <label
              htmlFor="bulk-role-change-reason"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1"
            >
              Audit Reason / Governance Note (optional)
            </label>
            <input
              id="bulk-role-change-reason"
              type="text"
              maxLength={240}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Semester I lecturer onboarding or departmental access review"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Mandatory Confirmation Controls */}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500"
              />
              <span>
                I confirm updating <strong className="font-semibold">{usersToUpdate.length}</strong>{' '}
                selected account{usersToUpdate.length === 1 ? '' : 's'} to{' '}
                <strong className="font-semibold">{ROLE_LABELS[nextRole]}</strong>.
              </span>
            </label>

            {requiresTypedConfirmation && (
              <div>
                <label
                  htmlFor="bulk-super-admin-phrase"
                  className="block text-xs font-medium text-red-600 dark:text-red-400 mb-1"
                >
                  Super Admin Safeguard: Type <span className="font-mono font-bold">CONFIRM</span> to proceed
                </label>
                <input
                  id="bulk-super-admin-phrase"
                  type="text"
                  value={phraseInput}
                  onChange={(e) => setPhraseInput(e.target.value)}
                  placeholder="Type CONFIRM"
                  autoComplete="off"
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-red-500/40 bg-red-500/5 text-slate-900 dark:text-white"
                />
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              disabled={loading}
              onClick={onCancel}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`px-4 py-2 text-xs font-semibold rounded-lg text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                requiresTypedConfirmation
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {loading
                ? 'Updating Roles...'
                : `Confirm Bulk Update (${usersToUpdate.length})`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
