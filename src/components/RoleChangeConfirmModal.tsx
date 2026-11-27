import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, ShieldAlert, X } from 'lucide-react';
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

interface RoleChangeConfirmModalProps {
  open: boolean;
  targetUser: UserProfile | null;
  nextRole: UserRole | null;
  linkedIdentifier?: string;
  linkedDepartment?: string;
  loading?: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function RoleChangeConfirmModal({
  open,
  targetUser,
  nextRole,
  linkedIdentifier,
  linkedDepartment,
  loading = false,
  onConfirm,
  onCancel,
}: RoleChangeConfirmModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [phraseInput, setPhraseInput] = useState('');
  const [reason, setReason] = useState('');

  const isPrivilegedTransition =
    nextRole === 'super_admin' || targetUser?.role === 'super_admin' || nextRole === 'admin';

  const requiresTypedConfirmation =
    nextRole === 'super_admin' || targetUser?.role === 'super_admin';

  useEffect(() => {
    setAcknowledged(false);
    setPhraseInput('');
    setReason('');
  }, [open, targetUser?.id, nextRole]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, loading, onCancel]);

  if (!open || !targetUser || !nextRole) return null;

  const canSubmit =
    !loading &&
    acknowledged &&
    (!requiresTypedConfirmation || phraseInput.trim().toUpperCase() === 'CONFIRM');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
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
              <h3 id="role-confirm-title" className="text-base font-bold text-slate-900 dark:text-white">
                Confirm System Role Change
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Review the permission impact before updating this user&apos;s access level.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
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
          className="p-6 space-y-5"
        >
          {/* Target User Identity */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 space-y-1">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{targetUser.displayName}</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 font-mono">
              <span>UID: {targetUser.uid}</span>
              {linkedIdentifier && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{linkedIdentifier}</span>
                </>
              )}
              {linkedDepartment && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-sans">{linkedDepartment}</span>
                </>
              )}
            </div>
          </div>

          {/* Current -> Target Role Comparison */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-1">
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Current Role</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {ROLE_LABELS[targetUser.role]}
              </p>
              <p className="text-[11px] font-mono text-slate-500">{targetUser.role}</p>
            </div>

            <div className="flex items-center justify-center text-slate-400">
              <ArrowRight className="w-4 h-4" />
            </div>

            <div
              className={`rounded-lg border p-3 space-y-1 ${
                requiresTypedConfirmation
                  ? 'border-red-500/40 bg-red-500/5'
                  : 'border-amber-500/40 bg-amber-500/5'
              }`}
            >
              <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">New Role</p>
              <p
                className={`text-sm font-semibold ${
                  requiresTypedConfirmation
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-amber-600 dark:text-amber-400'
                }`}
              >
                {ROLE_LABELS[nextRole]}
              </p>
              <p className="text-[11px] font-mono text-slate-500">{nextRole}</p>
            </div>
          </div>

          {/* Permission Impact */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-1.5 text-xs">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Access Impact</p>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              {ROLE_SCOPE_DESCRIPTIONS[nextRole]}
            </p>
            {isPrivilegedTransition && (
              <p className="text-amber-600 dark:text-amber-400 font-medium pt-1">
                High-privilege role transition: changes take effect immediately across Firestore rules and active sessions, and are recorded permanently in Audit Logs.
              </p>
            )}
          </div>

          {/* Optional Audit Note */}
          <div>
            <label
              htmlFor="role-change-reason"
              className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1"
            >
              Audit Reason / Governance Note (optional)
            </label>
            <input
              id="role-change-reason"
              type="text"
              maxLength={240}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Appointed lecturer for Semester I or promoted to Admin"
              className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          {/* Mandatory Safety Confirmation */}
          <div className="space-y-3 pt-1">
            <label className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500"
              />
              <span>
                I confirm changing <strong className="font-semibold">{targetUser.displayName}</strong> from{' '}
                <strong className="font-semibold">{ROLE_LABELS[targetUser.role]}</strong> to{' '}
                <strong className="font-semibold">{ROLE_LABELS[nextRole]}</strong>.
              </span>
            </label>

            {requiresTypedConfirmation && (
              <div>
                <label
                  htmlFor="super-admin-phrase"
                  className="block text-xs font-medium text-red-600 dark:text-red-400 mb-1"
                >
                  Super Admin Safeguard: Type <span className="font-mono font-bold">CONFIRM</span> to proceed
                </label>
                <input
                  id="super-admin-phrase"
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
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`px-4 py-2 text-xs font-semibold rounded-lg text-white transition-colors whitespace-nowrap disabled:opacity-50 ${
                requiresTypedConfirmation
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {loading ? 'Updating Role...' : `Confirm Change to ${ROLE_LABELS[nextRole]}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
