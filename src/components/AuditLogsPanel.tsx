import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  Eye,
  FileSpreadsheet,
  Lock,
  RotateCcw,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ErpDataset } from '../hooks/useErpData';
import { recordAuditLog } from '../lib/erpService';
import { exportToCSV } from '../lib/pdfGenerator';
import { AuditLog, ROLE_LABELS, UserRole } from '../types/erp';

interface AuditLogsPanelProps {
  data: ErpDataset;
  isSuperAdmin: boolean;
}

interface ParsedAuditMeta {
  previousRole?: string;
  newRole?: string;
  targetUid?: string;
  targetName?: string;
  reason?: string;
  isRoleChange: boolean;
  isPermissionEvent: boolean;
  isEscalation: boolean;
}

type ExportScope = 'filtered' | 'all' | 'role_changes' | 'escalations';

const PRIVILEGED_ROLES = new Set(['super_admin', 'admin', 'management']);
const ROLE_EVENT_ACTIONS = new Set([
  'USER_ROLE_CHANGED',
  'ROLE_INVITE_ISSUED',
  'USER_ACCOUNT_SUSPENDED',
  'USER_ACCOUNT_REACTIVATED',
  'STUDENT_ACCOUNT_ACTIVATED',
  'STUDENT_ACCOUNT_ADMIN_ACTIVATED',
  'STUDENT_LOGIN_BINDING_RESET',
  'AUDIT_HISTORY_CSV_EXPORTED',
]);

function formatRoleDisplay(role?: string): string {
  if (!role) return '—';
  return ROLE_LABELS[role as UserRole] || role;
}

function extractAuditMeta(log: AuditLog, userNameByUid: Map<string, string>): ParsedAuditMeta {
  let previousRole = log.previousRole;
  let newRole = log.newRole;
  let targetUid = log.targetUid;
  let targetName = log.targetName;
  let reason = log.reason;

  // Fallback parser for historical logs written before structured metadata fields
  if (log.action === 'USER_ROLE_CHANGED') {
    if (!targetUid && log.entityPath.startsWith('users/')) {
      targetUid = log.entityPath.slice('users/'.length);
    }
    const match = log.details.match(/^Changed (.+?) role from ([a-z_]+) to ([a-z_]+)\.(?:\s*Reason:\s*(.+))?$/i);
    if (match) {
      if (!targetName) targetName = match[1].trim();
      if (!previousRole) previousRole = match[2].trim();
      if (!newRole) newRole = match[3].trim();
      if (!reason && match[4]) reason = match[4].trim();
    }
  } else if (log.action === 'ROLE_INVITE_ISSUED') {
    const match = log.details.match(/^Pre-assigned role ([a-z_]+) to (.+?)\.?$/i);
    if (match) {
      if (!newRole) newRole = match[1].trim();
      if (!targetName) targetName = match[2].trim();
    }
  } else if (log.action === 'USER_ACCOUNT_SUSPENDED' || log.action === 'USER_ACCOUNT_REACTIVATED') {
    if (!targetUid && log.entityPath.startsWith('users/')) {
      targetUid = log.entityPath.slice('users/'.length);
    }
    const match = log.details.match(/^Set portal account status for (.+?) \(([^)]+)\) to (active|suspended)/i);
    if (match && !targetName) {
      targetName = match[1].trim();
    }
  }

  if (!targetName && targetUid) {
    targetName = userNameByUid.get(targetUid);
  }

  const isRoleChange = log.action === 'USER_ROLE_CHANGED' || log.action === 'ROLE_INVITE_ISSUED';
  const isPermissionEvent = ROLE_EVENT_ACTIONS.has(log.action);
  const isEscalation = Boolean(
    isRoleChange &&
      newRole &&
      PRIVILEGED_ROLES.has(newRole) &&
      (!previousRole || !PRIVILEGED_ROLES.has(previousRole) || newRole === 'super_admin')
  );

  return {
    previousRole,
    newRole,
    targetUid,
    targetName,
    reason,
    isRoleChange,
    isPermissionEvent,
    isEscalation,
  };
}

export function AuditLogsPanel({ data, isSuperAdmin }: AuditLogsPanelProps) {
  const { firebaseUser, profile, actualRole } = useAuth();
  const { showToast } = useToast();

  const [category, setCategory] = useState<'role_changes' | 'all' | 'status' | 'operations'>('role_changes');
  const [roleInvolvedFilter, setRoleInvolvedFilter] = useState<string>('all');
  const [dateWindow, setDateWindow] = useState<'all' | '24h' | '7d' | '30d' | 'custom'>('all');
  const [customFromDate, setCustomFromDate] = useState('');
  const [customToDate, setCustomToDate] = useState('');
  const [search, setSearch] = useState('');
  const [exportScope, setExportScope] = useState<ExportScope>('filtered');
  const [exporting, setExporting] = useState(false);
  const [selectedLog, setSelectedLog] = useState<(AuditLog & { meta: ParsedAuditMeta }) | null>(null);

  useEffect(() => {
    if (!selectedLog) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedLog(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedLog]);

  const userNameByUid = useMemo(
    () => new Map(data.users.map((u) => [u.uid, u.displayName])),
    [data.users]
  );

  const enrichedLogs = useMemo(() => {
    return [...data.auditLogs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((log) => ({
        ...log,
        meta: extractAuditMeta(log, userNameByUid),
      }));
  }, [data.auditLogs, userNameByUid]);

  const counts = useMemo(() => {
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    return {
      total: enrichedLogs.length,
      roleChanges: enrichedLogs.filter((l) => l.meta.isRoleChange).length,
      escalations: enrichedLogs.filter((l) => l.meta.isEscalation).length,
      statusEvents: enrichedLogs.filter(
        (l) => l.meta.isPermissionEvent && !l.meta.isRoleChange
      ).length,
      operations: enrichedLogs.filter((l) => !l.meta.isPermissionEvent).length,
      last24h: enrichedLogs.filter((l) => nowMs - new Date(l.createdAt).getTime() <= dayMs).length,
    };
  }, [enrichedLogs]);

  const filteredLogs = useMemo(() => {
    const nowMs = Date.now();
    const windowMs =
      dateWindow === '24h'
        ? 24 * 60 * 60 * 1000
        : dateWindow === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : dateWindow === '30d'
        ? 30 * 24 * 60 * 60 * 1000
        : null;

    const fromBoundMs =
      dateWindow === 'custom' && customFromDate
        ? new Date(`${customFromDate}T00:00:00`).getTime()
        : null;
    const toBoundMs =
      dateWindow === 'custom' && customToDate
        ? new Date(`${customToDate}T23:59:59.999`).getTime()
        : null;

    return enrichedLogs.filter((log) => {
      if (category === 'role_changes' && !log.meta.isRoleChange) return false;
      if (category === 'status' && !(log.meta.isPermissionEvent && !log.meta.isRoleChange)) return false;
      if (category === 'operations' && log.meta.isPermissionEvent) return false;

      if (roleInvolvedFilter !== 'all') {
        const matchesRole =
          log.meta.previousRole === roleInvolvedFilter ||
          log.meta.newRole === roleInvolvedFilter ||
          log.actorRole === roleInvolvedFilter;
        if (!matchesRole) return false;
      }

      const ts = new Date(log.createdAt).getTime();
      if (windowMs !== null && Number.isFinite(ts) && nowMs - ts > windowMs) {
        return false;
      }
      if (dateWindow === 'custom' && Number.isFinite(ts)) {
        if (fromBoundMs !== null && Number.isFinite(fromBoundMs) && ts < fromBoundMs) return false;
        if (toBoundMs !== null && Number.isFinite(toBoundMs) && ts > toBoundMs) return false;
      }

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          log.id.toLowerCase().includes(q) ||
          log.actorName.toLowerCase().includes(q) ||
          log.actorUid.toLowerCase().includes(q) ||
          log.action.toLowerCase().includes(q) ||
          log.entityPath.toLowerCase().includes(q) ||
          log.details.toLowerCase().includes(q) ||
          (log.meta.targetName || '').toLowerCase().includes(q) ||
          (log.meta.targetUid || '').toLowerCase().includes(q) ||
          (log.meta.previousRole || '').toLowerCase().includes(q) ||
          (log.meta.newRole || '').toLowerCase().includes(q) ||
          (log.meta.reason || '').toLowerCase().includes(q)
        );
      }

      return true;
    });
  }, [enrichedLogs, category, roleInvolvedFilter, dateWindow, customFromDate, customToDate, search]);

  const exportRecords = useMemo(() => {
    if (exportScope === 'all') return enrichedLogs;
    if (exportScope === 'role_changes') return enrichedLogs.filter((l) => l.meta.isRoleChange);
    if (exportScope === 'escalations') return enrichedLogs.filter((l) => l.meta.isEscalation);
    return filteredLogs;
  }, [exportScope, enrichedLogs, filteredLogs]);

  const hasActiveFilters =
    category !== 'role_changes' ||
    roleInvolvedFilter !== 'all' ||
    dateWindow !== 'all' ||
    Boolean(customFromDate) ||
    Boolean(customToDate) ||
    Boolean(search.trim());

  const resetFilters = () => {
    setCategory('role_changes');
    setRoleInvolvedFilter('all');
    setDateWindow('all');
    setCustomFromDate('');
    setCustomToDate('');
    setSearch('');
  };

  const handleExportComplianceCsv = async () => {
    if (!isSuperAdmin) {
      showToast('Super Admin privileges are required to export compliance audit history.', 'error');
      return;
    }
    if (exportRecords.length === 0) {
      showToast('No audit records match the selected compliance export scope.', 'info');
      return;
    }

    setExporting(true);
    const exportedAtIso = new Date().toISOString();
    const dateStamp = exportedAtIso.slice(0, 10);
    const scopeSlug =
      exportScope === 'all'
        ? 'Full_History'
        : exportScope === 'role_changes'
        ? 'Role_Changes'
        : exportScope === 'escalations'
        ? 'Privilege_Escalations'
        : 'Filtered_View';
    const filename = `EDUVANCE_Compliance_Audit_${scopeSlug}_${dateStamp}.csv`;
    const exportedByName = profile?.displayName || firebaseUser?.email || 'Super Admin';

    try {
      exportToCSV(
        filename,
        [
          'Audit Event ID',
          'Timestamp (ISO 8601 UTC)',
          'Local Time (EAT)',
          'Event Category',
          'Privilege Escalation',
          'Action Code',
          'Actor Name',
          'Actor UID',
          'Actor Role',
          'Target User',
          'Target UID',
          'Previous Role',
          'New Role',
          'Governance Reason',
          'Entity Path',
          'Details',
          'Exported By',
          'Exported At (ISO 8601 UTC)',
        ],
        exportRecords.map((l) => [
          l.id,
          l.createdAt,
          new Date(l.createdAt).toLocaleString('en-KE'),
          l.meta.isRoleChange
            ? 'Role & Permission Change'
            : l.meta.isPermissionEvent
            ? 'Access & Compliance'
            : 'Academic & Finance Operation',
          l.meta.isEscalation ? 'YES' : 'NO',
          l.action,
          l.actorName,
          l.actorUid,
          formatRoleDisplay(l.actorRole),
          l.meta.targetName || '',
          l.meta.targetUid || '',
          l.meta.previousRole ? formatRoleDisplay(l.meta.previousRole) : '',
          l.meta.newRole ? formatRoleDisplay(l.meta.newRole) : '',
          l.meta.reason || '',
          l.entityPath,
          l.details,
          exportedByName,
          exportedAtIso,
        ])
      );

      if (firebaseUser) {
        await recordAuditLog(
          {
            uid: firebaseUser.uid,
            name: exportedByName,
            role: actualRole,
          },
          'AUDIT_HISTORY_CSV_EXPORTED',
          'audit_logs/compliance_export',
          `Exported ${exportRecords.length} audit record(s) [${scopeSlug.replace(/_/g, ' ')}] to ${filename} for compliance reporting.`,
          {
            targetName: filename,
            reason: `Compliance CSV export (${scopeSlug.replace(/_/g, ' ')})`,
          }
        );
      }

      showToast(`Exported ${exportRecords.length} audit record(s) to ${filename}.`, 'success');
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Compliance CSV generated, but audit trail confirmation failed.',
        'error'
      );
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Audit Overview KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Role & Invite Changes',
            val: counts.roleChanges,
            accent: 'text-amber-600 dark:text-amber-400',
          },
          {
            label: 'Privilege Escalations',
            val: counts.escalations,
            accent: 'text-red-600 dark:text-red-400',
          },
          {
            label: 'Events (Last 24h)',
            val: counts.last24h,
            accent: 'text-blue-600 dark:text-blue-400',
          },
          {
            label: 'Total Immutable Logs',
            val: counts.total,
            accent: 'text-slate-900 dark:text-white',
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4"
          >
            <p className="text-xs text-slate-500 dark:text-slate-400">{stat.label}</p>
            <p className={`text-2xl font-bold font-mono tabular-nums mt-1 ${stat.accent}`}>{stat.val}</p>
          </div>
        ))}
      </div>

      {/* Filters & Compliance CSV Export Toolbar */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'role_changes', label: `Role Changes (${counts.roleChanges})` },
                { id: 'all', label: `All Audit Events (${counts.total})` },
                { id: 'status', label: `Access & Compliance (${counts.statusEvents})` },
                { id: 'operations', label: `Academic & Finance (${counts.operations})` },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setCategory(item.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  category === item.id
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-500 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Filters</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actor, target user, UID, role, or reason..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <select
            aria-label="Filter by role involved"
            value={roleInvolvedFilter}
            onChange={(e) => setRoleInvolvedFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            <option value="all">Any Role Involved</option>
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]} ({r})
              </option>
            ))}
          </select>

          <select
            aria-label="Filter by time window"
            value={dateWindow}
            onChange={(e) => setDateWindow(e.target.value as typeof dateWindow)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
          >
            <option value="all">All Time</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="custom">Custom Date Range</option>
          </select>

          {dateWindow === 'custom' && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="date"
                aria-label="Start date"
                value={customFromDate}
                onChange={(e) => setCustomFromDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono tabular-nums"
              />
              <span className="text-xs text-slate-400">to</span>
              <input
                type="date"
                aria-label="End date"
                value={customToDate}
                onChange={(e) => setCustomToDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono tabular-nums"
              />
            </div>
          )}
        </div>

        {/* Super Admin Compliance CSV Reporting Bar */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <FileSpreadsheet className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Compliance CSV Reporting
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                RFC-4180 UTF-8 export with actor UIDs, role transitions, escalation flags, and self-audited export tracking.
              </p>
            </div>
          </div>

          {isSuperAdmin ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                aria-label="Compliance export scope"
                value={exportScope}
                onChange={(e) => setExportScope(e.target.value as ExportScope)}
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                <option value="filtered">Current Filtered View ({filteredLogs.length})</option>
                <option value="all">Full Audit History ({counts.total})</option>
                <option value="role_changes">Role &amp; Permission Changes ({counts.roleChanges})</option>
                <option value="escalations">Privilege Escalations Only ({counts.escalations})</option>
              </select>

              <button
                type="button"
                disabled={exporting || exportRecords.length === 0}
                onClick={handleExportComplianceCsv}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {exporting
                    ? 'Preparing CSV...'
                    : `Export Compliance CSV (${exportRecords.length})`}
                </span>
              </button>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Compliance CSV export is restricted to Super Admins.</span>
            </div>
          )}
        </div>
      </div>

      {/* Immutable Audit Trail Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              {category === 'role_changes'
                ? `Role & Permission Modification Audit Trail (${filteredLogs.length})`
                : `Immutable System Audit Log (${filteredLogs.length})`}
            </h3>
          </div>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            Append-only · Updates and deletions disabled in Firestore rules
          </span>
        </div>

        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="py-3 px-4 font-medium">Timestamp</th>
              <th className="py-3 px-4 font-medium">Modified By (Actor)</th>
              <th className="py-3 px-4 font-medium">Event &amp; Target Account</th>
              <th className="py-3 px-4 font-medium">Role / Permission Change</th>
              <th className="py-3 px-4 font-medium">Details &amp; Reason</th>
              <th className="py-3 px-4 font-medium text-right">Inspect</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredLogs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                  {new Date(log.createdAt).toLocaleString('en-KE')}
                </td>

                <td className="py-3 px-4">
                  <p className="font-semibold text-slate-900 dark:text-slate-100">{log.actorName}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {formatRoleDisplay(log.actorRole)} · <span className="font-mono">{log.actorUid.slice(0, 10)}</span>
                  </p>
                </td>

                <td className="py-3 px-4">
                  <p
                    className={`font-mono font-semibold ${
                      log.meta.isEscalation
                        ? 'text-red-600 dark:text-red-400'
                        : log.meta.isRoleChange
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    {log.action}
                  </p>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                    {log.meta.targetName ? (
                      <>
                        <span className="font-medium">{log.meta.targetName}</span>
                        {log.meta.targetUid && (
                          <span className="font-mono text-slate-400"> · {log.meta.targetUid.slice(0, 10)}</span>
                        )}
                      </>
                    ) : (
                      <span className="font-mono text-slate-500">{log.entityPath}</span>
                    )}
                  </p>
                </td>

                <td className="py-3 px-4 whitespace-nowrap">
                  {log.meta.isRoleChange && (log.meta.previousRole || log.meta.newRole) ? (
                    <div className="inline-flex items-center gap-1.5">
                      {log.meta.previousRole ? (
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {formatRoleDisplay(log.meta.previousRole)}
                        </span>
                      ) : (
                        <span className="text-slate-400">Invited</span>
                      )}
                      <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                      <span
                        className={`font-semibold ${
                          log.meta.isEscalation
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {formatRoleDisplay(log.meta.newRole)}
                      </span>
                    </div>
                  ) : log.action === 'USER_ACCOUNT_SUSPENDED' ? (
                    <span className="font-semibold text-red-600 dark:text-red-400">Account Suspended</span>
                  ) : log.action === 'USER_ACCOUNT_REACTIVATED' ? (
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">Account Restored</span>
                  ) : log.action === 'AUDIT_HISTORY_CSV_EXPORTED' ? (
                    <span className="font-semibold text-blue-600 dark:text-blue-400">Compliance Export</span>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>

                <td className="py-3 px-4 max-w-md">
                  <p className="text-slate-600 dark:text-slate-300 line-clamp-2">{log.details}</p>
                  {log.meta.reason && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                      Note: {log.meta.reason}
                    </p>
                  )}
                </td>

                <td className="py-3 px-4 text-right whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() => setSelectedLog(log)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                  >
                    <Eye className="w-3 h-3 text-amber-500" />
                    <span>Inspect</span>
                  </button>
                </td>
              </tr>
            ))}

            {filteredLogs.length === 0 && (
              <tr>
                <td colSpan={6} className="py-10 text-center space-y-3">
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {category === 'role_changes' && counts.roleChanges === 0
                      ? 'No role modifications recorded yet. Updating a user role in the User Roles tab will appear here immediately.'
                      : 'No audit events match the selected filters.'}
                  </p>
                  {category === 'role_changes' && counts.total > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCategory('all');
                        setRoleInvolvedFilter('all');
                        setDateWindow('all');
                        setCustomFromDate('');
                        setCustomToDate('');
                        setSearch('');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0"
                    >
                      View All System Audit Events ({counts.total})
                    </button>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Audit Record Detail Modal */}
      {selectedLog && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="audit-detail-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
              <div>
                <h3 id="audit-detail-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  Immutable Audit Record
                </h3>
                <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{selectedLog.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                aria-label="Close audit record dialog"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Timestamp</p>
                  <p className="font-mono font-medium text-slate-900 dark:text-slate-100 mt-0.5 tabular-nums">
                    {new Date(selectedLog.createdAt).toLocaleString('en-KE')}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Action Code</p>
                  <p className="font-mono font-semibold text-amber-600 dark:text-amber-400 mt-0.5">
                    {selectedLog.action}
                  </p>
                </div>
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Actor (Initiated By)</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {selectedLog.actorName} ({formatRoleDisplay(selectedLog.actorRole)})
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">{selectedLog.actorUid}</p>
                </div>
                <div>
                  <p className="text-slate-500 dark:text-slate-400">Target Entity</p>
                  <p className="font-semibold text-slate-900 dark:text-slate-100 mt-0.5">
                    {selectedLog.meta.targetName || selectedLog.entityPath}
                  </p>
                  <p className="font-mono text-[11px] text-slate-500">{selectedLog.entityPath}</p>
                </div>
              </div>

              {selectedLog.meta.isRoleChange && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-3.5 space-y-1.5">
                  <p className="font-semibold text-slate-800 dark:text-slate-200">Permission Transition</p>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-slate-600 dark:text-slate-300 font-medium">
                      {formatRoleDisplay(selectedLog.meta.previousRole)}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-400" />
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {formatRoleDisplay(selectedLog.meta.newRole)}
                    </span>
                  </div>
                  {selectedLog.meta.reason && (
                    <p className="text-slate-600 dark:text-slate-300 pt-1">
                      Governance Reason: <span className="font-medium">{selectedLog.meta.reason}</span>
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <p className="text-slate-500 dark:text-slate-400">Recorded Details</p>
                <p className="text-slate-800 dark:text-slate-200 leading-relaxed">{selectedLog.details}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
