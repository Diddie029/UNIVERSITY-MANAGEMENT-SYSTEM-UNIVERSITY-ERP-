import React, { useMemo, useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Lock, Search, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { ConfirmDialog } from './ConfirmDialog';
import { RoleChangeConfirmModal } from './RoleChangeConfirmModal';
import { BulkRoleChangeConfirmModal } from './BulkRoleChangeConfirmModal';
import { ErpDataset } from '../hooks/useErpData';
import {
  BOOTSTRAPPED_ADMIN_EMAIL,
  clampStr,
  db,
  handleFirestoreError,
  OperationType,
} from '../lib/firebase';
import { bulkUpdateUserRoles, recordAuditLog } from '../lib/erpService';
import { ROLE_LABELS, UserProfile, UserRole } from '../types/erp';

interface UserRoleManagementPanelProps {
  data: ErpDataset;
  isSuperAdmin: boolean;
}

const CORE_ROLE_TOGGLES: { role: UserRole; shortLabel: string }[] = [
  { role: 'student', shortLabel: 'Student' },
  { role: 'lecturer', shortLabel: 'Lecturer' },
  { role: 'admin', shortLabel: 'Admin' },
  { role: 'super_admin', shortLabel: 'Super Admin' },
];

const SPECIALIZED_ROLES: UserRole[] = [
  'management',
  'admissions',
  'hod',
  'exam_officer',
  'finance',
  'hr',
  'applicant',
];

function getRoleTextAccent(role: UserRole): string {
  switch (role) {
    case 'super_admin':
      return 'text-red-600 dark:text-red-400';
    case 'admin':
    case 'management':
      return 'text-amber-600 dark:text-amber-400';
    case 'lecturer':
    case 'hod':
    case 'exam_officer':
      return 'text-blue-600 dark:text-blue-400';
    case 'student':
      return 'text-emerald-600 dark:text-emerald-400';
    default:
      return 'text-slate-700 dark:text-slate-300';
  }
}

export function UserRoleManagementPanel({ data, isSuperAdmin }: UserRoleManagementPanelProps) {
  const { firebaseUser, profile } = useAuth();
  const { showToast } = useToast();

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<
    'all' | 'student' | 'lecturer' | 'admin' | 'super_admin' | 'other'
  >('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');

  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: UserProfile;
    nextRole: UserRole;
    linkedIdentifier?: string;
    linkedDepartment?: string;
  } | null>(null);
  const [savingRole, setSavingRole] = useState(false);

  const [pendingStatusToggle, setPendingStatusToggle] = useState<UserProfile | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);

  // Multi-user bulk selection & role update state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkTargetRole, setBulkTargetRole] = useState<UserRole>('lecturer');
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [savingBulkRole, setSavingBulkRole] = useState(false);

  const deptById = useMemo(
    () => new Map(data.departments.map((d) => [d.id, d.name])),
    [data.departments]
  );
  const studentById = useMemo(
    () => new Map(data.students.map((s) => [s.id, s])),
    [data.students]
  );
  const studentByUid = useMemo(
    () => new Map(data.students.filter((s) => s.uid).map((s) => [s.uid!, s])),
    [data.students]
  );
  const employeeById = useMemo(
    () => new Map(data.employees.map((e) => [e.id, e])),
    [data.employees]
  );
  const employeeByUid = useMemo(
    () => new Map(data.employees.filter((e) => e.uid).map((e) => [e.uid!, e])),
    [data.employees]
  );

  const enrichedUsers = useMemo(() => {
    return [...data.users]
      .map((u) => {
        const linkedStu = (u.studentId ? studentById.get(u.studentId) : undefined) || studentByUid.get(u.uid);
        const linkedEmp = (u.employeeId ? employeeById.get(u.employeeId) : undefined) || employeeByUid.get(u.uid);
        const linkedIdentifier = linkedStu?.admissionNo || linkedEmp?.staffNo || '';
        const deptId = u.departmentId || linkedStu?.departmentId || linkedEmp?.departmentId || '';
        const departmentName =
          deptById.get(deptId) ||
          linkedEmp?.departmentName ||
          linkedStu?.programmeName ||
          (u.role === 'super_admin' || u.role === 'admin' ? 'Central Administration' : 'Institutional Portal');

        const isSelf = u.uid === firebaseUser?.uid;
        const isBootstrappedAccount =
          isSelf &&
          firebaseUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase();

        return {
          user: u,
          linkedIdentifier,
          departmentName,
          isSelf,
          isProtected: isSelf || isBootstrappedAccount,
        };
      })
      .sort((a, b) => {
        const rank = (r: UserRole) =>
          r === 'super_admin' ? 0 : r === 'admin' ? 1 : r === 'management' ? 2 : r === 'lecturer' ? 3 : r === 'student' ? 4 : 5;
        const diff = rank(a.user.role) - rank(b.user.role);
        if (diff !== 0) return diff;
        return a.user.displayName.localeCompare(b.user.displayName);
      });
  }, [data.users, studentById, studentByUid, employeeById, employeeByUid, deptById, firebaseUser]);

  const roleCounts = useMemo(
    () => ({
      total: enrichedUsers.length,
      student: enrichedUsers.filter((x) => x.user.role === 'student').length,
      lecturer: enrichedUsers.filter((x) => x.user.role === 'lecturer').length,
      admin: enrichedUsers.filter((x) => x.user.role === 'admin' || x.user.role === 'management').length,
      super_admin: enrichedUsers.filter((x) => x.user.role === 'super_admin').length,
      other: enrichedUsers.filter(
        (x) => !['student', 'lecturer', 'admin', 'management', 'super_admin'].includes(x.user.role)
      ).length,
    }),
    [enrichedUsers]
  );

  const filteredUsers = useMemo(() => {
    return enrichedUsers.filter(({ user, linkedIdentifier, departmentName }) => {
      if (roleFilter === 'student' && user.role !== 'student') return false;
      if (roleFilter === 'lecturer' && user.role !== 'lecturer') return false;
      if (roleFilter === 'admin' && user.role !== 'admin' && user.role !== 'management') return false;
      if (roleFilter === 'super_admin' && user.role !== 'super_admin') return false;
      if (
        roleFilter === 'other' &&
        ['student', 'lecturer', 'admin', 'management', 'super_admin'].includes(user.role)
      ) {
        return false;
      }
      if (statusFilter !== 'all' && user.status !== statusFilter) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        return (
          user.displayName.toLowerCase().includes(q) ||
          user.uid.toLowerCase().includes(q) ||
          user.role.toLowerCase().includes(q) ||
          ROLE_LABELS[user.role].toLowerCase().includes(q) ||
          linkedIdentifier.toLowerCase().includes(q) ||
          departmentName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [enrichedUsers, roleFilter, statusFilter, search]);

  const selectableVisibleUsers = useMemo(
    () => filteredUsers.filter((x) => !x.isProtected),
    [filteredUsers]
  );

  const selectedTargets = useMemo(
    () =>
      enrichedUsers
        .filter((x) => !x.isProtected && selectedIds.has(x.user.id))
        .map((x) => ({
          user: x.user,
          identifier: x.linkedIdentifier,
          departmentName: x.departmentName,
        })),
    [enrichedUsers, selectedIds]
  );

  const allVisibleSelected =
    selectableVisibleUsers.length > 0 &&
    selectableVisibleUsers.every((x) => selectedIds.has(x.user.id));

  const someVisibleSelected =
    selectableVisibleUsers.some((x) => selectedIds.has(x.user.id)) && !allVisibleSelected;

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        selectableVisibleUsers.forEach((x) => next.delete(x.user.id));
      } else {
        selectableVisibleUsers.forEach((x) => next.add(x.user.id));
      }
      return next;
    });
  };

  const handleOpenBulkConfirm = () => {
    if (!isSuperAdmin || selectedTargets.length === 0) return;
    const updatableCount = selectedTargets.filter((t) => t.user.role !== bulkTargetRole).length;
    if (updatableCount === 0) {
      showToast(
        `All ${selectedTargets.length} selected user(s) already hold the ${ROLE_LABELS[bulkTargetRole]} role.`,
        'info'
      );
      return;
    }
    setBulkConfirmOpen(true);
  };

  const handleConfirmBulkRoleChange = async (reason: string) => {
    if (!firebaseUser || !profile || !isSuperAdmin || selectedTargets.length === 0) return;
    setSavingBulkRole(true);
    try {
      const { updatedCount, skippedCount } = await bulkUpdateUserRoles(
        selectedTargets.map((t) => t.user),
        bulkTargetRole,
        reason,
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role }
      );
      if (updatedCount > 0) {
        showToast(
          `Updated ${updatedCount} user${updatedCount === 1 ? '' : 's'} to ${ROLE_LABELS[bulkTargetRole]}${
            skippedCount > 0 ? ` (${skippedCount} unchanged)` : ''
          }.`,
          'success'
        );
      } else {
        showToast('No user roles required updating.', 'info');
      }
      setSelectedIds(new Set());
      setBulkConfirmOpen(false);
    } finally {
      setSavingBulkRole(false);
    }
  };

  const requestRoleChange = (
    user: UserProfile,
    nextRole: UserRole,
    linkedIdentifier?: string,
    linkedDepartment?: string
  ) => {
    if (!isSuperAdmin) return;
    if (user.uid === firebaseUser?.uid) {
      showToast(
        'Your own active Super Admin account is protected. Use Portal Role Preview in the sidebar to test other views.',
        'error'
      );
      return;
    }
    if (user.role === nextRole) return;
    setPendingRoleChange({ user, nextRole, linkedIdentifier, linkedDepartment });
  };

  const handleConfirmRoleChange = async (reason: string) => {
    if (!firebaseUser || !profile || !isSuperAdmin || !pendingRoleChange) return;
    const { user, nextRole } = pendingRoleChange;
    const now = new Date().toISOString();

    setSavingRole(true);
    try {
      await updateDoc(doc(db, 'users', user.id), {
        role: nextRole,
        updatedAt: now,
      });

      const cleanReason = clampStr(reason, 240);
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'USER_ROLE_CHANGED',
        `users/${user.id}`,
        cleanReason
          ? `Changed ${user.displayName} role from ${user.role} to ${nextRole}. Reason: ${cleanReason}`
          : `Changed ${user.displayName} role from ${user.role} to ${nextRole}.`,
        {
          previousRole: user.role,
          newRole: nextRole,
          targetUid: user.uid,
          targetName: user.displayName,
          reason: cleanReason,
        }
      );

      showToast(
        `Updated ${user.displayName} from ${ROLE_LABELS[user.role]} to ${ROLE_LABELS[nextRole]}.`,
        'success'
      );
      setPendingRoleChange(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.id}`);
    } finally {
      setSavingRole(false);
    }
  };

  const handleConfirmStatusToggle = async () => {
    if (!firebaseUser || !profile || !isSuperAdmin || !pendingStatusToggle) return;
    const target = pendingStatusToggle;
    const nextStatus = target.status === 'suspended' ? 'active' : 'suspended';
    const now = new Date().toISOString();

    setSavingStatus(true);
    try {
      await updateDoc(doc(db, 'users', target.id), {
        status: nextStatus,
        updatedAt: now,
      });

      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        nextStatus === 'suspended' ? 'USER_ACCOUNT_SUSPENDED' : 'USER_ACCOUNT_REACTIVATED',
        `users/${target.id}`,
        `Set portal account status for ${target.displayName} (${target.uid}) to ${nextStatus}.`,
        {
          previousRole: target.role,
          newRole: target.role,
          targetUid: target.uid,
          targetName: target.displayName,
        }
      );

      showToast(
        `${target.displayName} is now ${nextStatus === 'suspended' ? 'Suspended' : 'Active'}.`,
        nextStatus === 'suspended' ? 'info' : 'success'
      );
      setPendingStatusToggle(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${target.id}`);
    } finally {
      setSavingStatus(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Role Distribution Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Registered Users', val: roleCounts.total, accent: 'text-slate-900 dark:text-white' },
          { label: 'Students', val: roleCounts.student, accent: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Lecturers', val: roleCounts.lecturer, accent: 'text-blue-600 dark:text-blue-400' },
          { label: 'Admins & Mgmt', val: roleCounts.admin, accent: 'text-amber-600 dark:text-amber-400' },
          { label: 'Super Admins', val: roleCounts.super_admin, accent: 'text-red-600 dark:text-red-400' },
          { label: 'Other Staff / Apps', val: roleCounts.other, accent: 'text-slate-700 dark:text-slate-300' },
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

      {/* Safeguard Banner */}
      {!isSuperAdmin && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex items-center gap-3 text-xs text-amber-700 dark:text-amber-300">
          <Lock className="w-4 h-4 shrink-0" />
          <span>
            Read-only view: Only an active Super Administrator can modify user system roles or account statuses.
          </span>
        </div>
      )}

      {/* Search & Segmented Role Filters */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative min-w-[220px] flex-1 max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search registered user, UID, reg/staff no..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {(
              [
                { id: 'all', label: 'All Roles' },
                { id: 'student', label: 'Student' },
                { id: 'lecturer', label: 'Lecturer' },
                { id: 'admin', label: 'Admin' },
                { id: 'super_admin', label: 'Super Admin' },
                { id: 'other', label: 'Other' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setRoleFilter(f.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  roleFilter === f.id
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            aria-label="Filter by account status"
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="suspended">Suspended Only</option>
          </select>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Role updates always require confirmation and are logged to Audit Trail.
        </p>
      </div>

      {/* Registered Users Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Registered Portal Users &amp; Role Assignment ({filteredUsers.length})
            </h3>
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {data.users.length} total accounts in Firestore
          </span>
        </div>

        {isSuperAdmin && selectedTargets.length > 0 && (
          <div className="px-5 py-3 border-b border-amber-500/30 bg-amber-500/5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
                <Users className="w-3.5 h-3.5 text-amber-500" />
                <span>{selectedTargets.length} selected</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0"
              >
                Clear Selection
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <label htmlFor="bulk-role-select" className="text-xs text-slate-600 dark:text-slate-300">
                Assign role:
              </label>
              <select
                id="bulk-role-select"
                value={bulkTargetRole}
                onChange={(e) => setBulkTargetRole(e.target.value as UserRole)}
                className="px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]} ({r})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleOpenBulkConfirm}
                className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors whitespace-nowrap shrink-0"
              >
                Update Selected Roles ({selectedTargets.length})
              </button>
            </div>
          </div>
        )}

        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
            <tr>
              {isSuperAdmin && (
                <th className="py-3 pl-4 pr-2 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all selectable visible users"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someVisibleSelected;
                    }}
                    disabled={selectableVisibleUsers.length === 0}
                    onChange={toggleSelectAllVisible}
                    className="rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500 disabled:opacity-40"
                  />
                </th>
              )}
              <th className="py-3 px-4 font-medium">Registered User</th>
              <th className="py-3 px-4 font-medium">Current Role &amp; Status</th>
              <th className="py-3 px-4 font-medium">Quick Role Toggle (Requires Confirmation)</th>
              <th className="py-3 px-4 font-medium">Specialized Role</th>
              <th className="py-3 px-4 font-medium text-right">Access Control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {filteredUsers.map(({ user, linkedIdentifier, departmentName, isSelf, isProtected }) => {
              const isSpecialized = !CORE_ROLE_TOGGLES.some((c) => c.role === user.role);
              const isSelected = selectedIds.has(user.id);
              return (
                <tr
                  key={user.id}
                  className={
                    isSelected
                      ? 'bg-amber-500/5 hover:bg-amber-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }
                >
                  {isSuperAdmin && (
                    <td className="py-3.5 pl-4 pr-2 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Select ${user.displayName}`}
                        disabled={isProtected}
                        checked={isSelected}
                        onChange={() => toggleSelectOne(user.id)}
                        title={
                          isProtected
                            ? 'Protected Super Admin account cannot be bulk modified'
                            : `Select ${user.displayName}`
                        }
                        className="rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500 disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                  )}
                  <td className="py-3.5 px-4">
                    <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                      {user.displayName}
                      {isSelf && (
                        <span className="ml-2 text-xs font-normal text-amber-600 dark:text-amber-400">
                          (You)
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      <span className="font-mono">{user.uid}</span>
                      {linkedIdentifier && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-amber-600 dark:text-amber-400">
                            {linkedIdentifier}
                          </span>
                        </>
                      )}
                      <span aria-hidden="true">·</span>
                      <span>{departmentName}</span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <p className={`font-semibold ${getRoleTextAccent(user.role)}`}>
                      {ROLE_LABELS[user.role]}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      <span
                        className={
                          user.status === 'suspended'
                            ? 'text-red-600 dark:text-red-400 font-medium'
                            : 'text-emerald-600 dark:text-emerald-400 font-medium'
                        }
                      >
                        {user.status === 'suspended' ? 'Suspended' : 'Active'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {new Date(user.lastActiveAt || user.updatedAt).toLocaleDateString('en-KE')}
                      </span>
                    </div>
                  </td>

                  <td className="py-3.5 px-4">
                    {isProtected ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                        <Lock className="w-3 h-3" />
                        <span>Self-demotion locked</span>
                      </span>
                    ) : (
                      <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                        {CORE_ROLE_TOGGLES.map((item) => {
                          const active = user.role === item.role;
                          return (
                            <button
                              key={item.role}
                              type="button"
                              disabled={!isSuperAdmin || active}
                              onClick={() =>
                                requestRoleChange(user, item.role, linkedIdentifier, departmentName)
                              }
                              className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                                active
                                  ? item.role === 'super_admin'
                                    ? 'bg-red-600 text-white shadow-sm'
                                    : 'bg-amber-600 text-white shadow-sm'
                                  : 'text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-[#1E293B] hover:text-slate-900 dark:hover:text-white disabled:opacity-50'
                              }`}
                            >
                              {item.shortLabel}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </td>

                  <td className="py-3.5 px-4">
                    {isProtected ? (
                      <span className="text-[11px] text-slate-400">Protected</span>
                    ) : (
                      <select
                        aria-label={`Assign specialized role for ${user.displayName}`}
                        disabled={!isSuperAdmin}
                        value={isSpecialized ? user.role : ''}
                        onChange={(e) => {
                          const val = e.target.value as UserRole;
                          if (val) requestRoleChange(user, val, linkedIdentifier, departmentName);
                        }}
                        className="px-2.5 py-1.5 text-[11px] rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-200 disabled:opacity-50"
                      >
                        <option value="" disabled>
                          {isSpecialized ? ROLE_LABELS[user.role] : 'Other ERP role...'}
                        </option>
                        {SPECIALIZED_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>

                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    {isSuperAdmin && !isProtected ? (
                      <button
                        type="button"
                        onClick={() => setPendingStatusToggle(user)}
                        className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                          user.status === 'suspended'
                            ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10'
                            : 'border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10'
                        }`}
                      >
                        {user.status === 'suspended' ? (
                          <>
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Restore</span>
                          </>
                        ) : (
                          <>
                            <UserX className="w-3.5 h-3.5" />
                            <span>Suspend</span>
                          </>
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filteredUsers.length === 0 && (
              <tr>
                <td colSpan={isSuperAdmin ? 6 : 5} className="py-10 text-center text-xs text-slate-500">
                  No registered portal users match the selected filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Role Change Confirmation Modal */}
      <RoleChangeConfirmModal
        open={Boolean(pendingRoleChange)}
        targetUser={pendingRoleChange?.user ?? null}
        nextRole={pendingRoleChange?.nextRole ?? null}
        linkedIdentifier={pendingRoleChange?.linkedIdentifier}
        linkedDepartment={pendingRoleChange?.linkedDepartment}
        loading={savingRole}
        onConfirm={handleConfirmRoleChange}
        onCancel={() => !savingRole && setPendingRoleChange(null)}
      />

      {/* Account Suspend / Restore Confirmation Modal */}
      <ConfirmDialog
        open={Boolean(pendingStatusToggle)}
        title={
          pendingStatusToggle?.status === 'suspended'
            ? 'Reactivate User Account'
            : 'Suspend User Account'
        }
        description={
          pendingStatusToggle
            ? pendingStatusToggle.status === 'suspended'
              ? `Restore portal access for ${pendingStatusToggle.displayName} (${ROLE_LABELS[pendingStatusToggle.role]})?`
              : `Suspend ${pendingStatusToggle.displayName} (${ROLE_LABELS[pendingStatusToggle.role]})? They will be marked suspended across institutional user directories.`
            : ''
        }
        confirmLabel={
          pendingStatusToggle?.status === 'suspended' ? 'Restore Account' : 'Suspend Account'
        }
        danger={pendingStatusToggle?.status !== 'suspended'}
        loading={savingStatus}
        onConfirm={handleConfirmStatusToggle}
        onCancel={() => !savingStatus && setPendingStatusToggle(null)}
      />

      {/* Bulk Role Change Confirmation Modal */}
      <BulkRoleChangeConfirmModal
        open={bulkConfirmOpen}
        targets={selectedTargets}
        nextRole={bulkTargetRole}
        loading={savingBulkRole}
        onConfirm={handleConfirmBulkRoleChange}
        onCancel={() => !savingBulkRole && setBulkConfirmOpen(false)}
      />
    </div>
  );
}
