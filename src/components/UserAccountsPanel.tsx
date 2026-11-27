import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import {
  Activity,
  CheckCircle2,
  FileSpreadsheet,
  KeyRound,
  Search,
  Shield,
  UserCheck,
  UserPlus,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { RoleChangeConfirmModal } from './RoleChangeConfirmModal';
import { BulkRoleChangeConfirmModal } from './BulkRoleChangeConfirmModal';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, OperationType, sanitizeId } from '../lib/firebase';
import { bulkUpdateUserRoles, recordAuditLog } from '../lib/erpService';
import { AuditLog, ROLE_LABELS, UserProfile, UserRole } from '../types/erp';

interface UserAccountsPanelProps {
  data: ErpDataset;
  isSuperAdmin: boolean;
  onOpenBulkImport: () => void;
}

interface UnifiedAccountRow {
  rowId: string;
  group: 'student' | 'lecturer' | 'staff_admin';
  displayName: string;
  identifier: string;
  roleLabel: string;
  departmentId: string;
  departmentName: string;
  accountStatus: 'Active' | 'Pending Activation' | 'Suspended';
  lastActivityAt: string;
  latestAction: string;
  activityCount: number;
  userDoc?: UserProfile;
  studentId?: string;
  employeeId?: string;
  admissionNo?: string;
}

export function UserAccountsPanel({ data, isSuperAdmin, onOpenBulkImport }: UserAccountsPanelProps) {
  const { firebaseUser, profile } = useAuth();
  const { showToast } = useToast();

  const [groupFilter, setGroupFilter] = useState<'all' | 'student' | 'lecturer' | 'staff_admin'>('all');
  const [deptFilter, setDeptFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Pending Activation' | 'Suspended'>('all');
  const [search, setSearch] = useState('');

  // Staff Role Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<UserRole, 'applicant'>>('lecturer');
  const [inviteDeptId, setInviteDeptId] = useState('');

  // Selected user activity drawer
  const [activityTarget, setActivityTarget] = useState<UnifiedAccountRow | null>(null);

  // Role change confirmation modal
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    user: UserProfile;
    nextRole: UserRole;
    identifier?: string;
    departmentName?: string;
  } | null>(null);
  const [savingRole, setSavingRole] = useState(false);

  // Bulk role selection & confirmation modal
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(() => new Set());
  const [bulkTargetRole, setBulkTargetRole] = useState<UserRole>('lecturer');
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [savingBulkRole, setSavingBulkRole] = useState(false);

  const deptNameById = useMemo(
    () => new Map(data.departments.map((d) => [d.id, d.name])),
    [data.departments]
  );

  // Build unified directory across Students, Lecturers, and System Users/Admins
  const unifiedAccounts: UnifiedAccountRow[] = useMemo(() => {
    const rows: UnifiedAccountRow[] = [];
    const coveredUserUids = new Set<string>();

    const findActivity = (uid?: string, name?: string, code?: string): AuditLog[] => {
      return data.auditLogs.filter(
        (l) =>
          (uid && l.actorUid === uid) ||
          (name && l.actorName.toLowerCase() === name.toLowerCase()) ||
          (code && l.details.includes(code))
      );
    };

    // 1. Students
    for (const stu of data.students) {
      const userDoc = data.users.find((u) => u.studentId === stu.id || (stu.uid && u.uid === stu.uid));
      if (userDoc) coveredUserUids.add(userDoc.uid);

      const logs = findActivity(userDoc?.uid || stu.uid, stu.fullName, stu.admissionNo).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );

      let accountStatus: UnifiedAccountRow['accountStatus'] = 'Active';
      if (userDoc?.status === 'suspended' || stu.academicStatus === 'Discontinued') {
        accountStatus = 'Suspended';
      } else if (stu.accountActivated === false) {
        accountStatus = 'Pending Activation';
      }

      rows.push({
        rowId: `stu_${stu.id}`,
        group: 'student',
        displayName: stu.fullName,
        identifier: stu.admissionNo,
        roleLabel: `Student · Yr ${stu.yearOfStudy}.${stu.semester}`,
        departmentId: stu.departmentId || '',
        departmentName: deptNameById.get(stu.departmentId || '') || stu.programmeName || 'Academic Dept',
        accountStatus,
        lastActivityAt: userDoc?.lastActiveAt || logs[0]?.createdAt || stu.updatedAt,
        latestAction: logs[0]?.action || (stu.accountActivated === false ? 'Awaiting Activation' : 'Enrolled'),
        activityCount: logs.length,
        userDoc,
        studentId: stu.id,
        admissionNo: stu.admissionNo,
      });
    }

    // 2. HR Employees (Lecturers & Non-Teaching Staff)
    for (const emp of data.employees) {
      const userDoc = data.users.find((u) => u.employeeId === emp.id || (emp.uid && u.uid === emp.uid));
      if (userDoc) coveredUserUids.add(userDoc.uid);

      const titleLower = emp.jobTitle.toLowerCase();
      const isLecturer =
        titleLower.includes('lecturer') ||
        titleLower.includes('professor') ||
        titleLower.includes('hod') ||
        titleLower.includes('dean') ||
        titleLower.includes('tutor') ||
        (userDoc && ['lecturer', 'hod', 'exam_officer'].includes(userDoc.role));

      const logs = findActivity(userDoc?.uid || emp.uid, emp.fullName, emp.staffNo).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );

      const accountStatus: UnifiedAccountRow['accountStatus'] =
        userDoc?.status === 'suspended' || emp.status === 'Terminated' ? 'Suspended' : 'Active';

      rows.push({
        rowId: `emp_${emp.id}`,
        group: isLecturer ? 'lecturer' : 'staff_admin',
        displayName: emp.fullName,
        identifier: emp.staffNo,
        roleLabel: userDoc ? ROLE_LABELS[userDoc.role] : emp.jobTitle,
        departmentId: emp.departmentId,
        departmentName: emp.departmentName || deptNameById.get(emp.departmentId) || 'University Dept',
        accountStatus,
        lastActivityAt: userDoc?.lastActiveAt || logs[0]?.createdAt || emp.updatedAt,
        latestAction: logs[0]?.action || emp.status,
        activityCount: logs.length,
        userDoc,
        employeeId: emp.id,
      });
    }

    // 3. Remaining Portal User Accounts (Super Admins, Management, Applicants, Invited Users)
    for (const u of data.users) {
      if (coveredUserUids.has(u.uid)) continue;
      const isLec = ['lecturer', 'hod', 'exam_officer'].includes(u.role);
      const isStu = u.role === 'student';

      const logs = findActivity(u.uid, u.displayName).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      );

      rows.push({
        rowId: `usr_${u.id}`,
        group: isStu ? 'student' : isLec ? 'lecturer' : 'staff_admin',
        displayName: u.displayName,
        identifier: `UID:${u.uid.slice(0, 10)}`,
        roleLabel: ROLE_LABELS[u.role],
        departmentId: u.departmentId || '',
        departmentName:
          deptNameById.get(u.departmentId || '') ||
          (u.role === 'super_admin' ? 'Central Administration' : 'Institutional Portal'),
        accountStatus:
          u.status === 'suspended'
            ? 'Suspended'
            : u.accountActivated === false
            ? 'Pending Activation'
            : 'Active',
        lastActivityAt: u.lastActiveAt || logs[0]?.createdAt || u.updatedAt,
        latestAction: logs[0]?.action || 'Signed In',
        activityCount: logs.length,
        userDoc: u,
      });
    }

    return rows.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }, [data.students, data.employees, data.users, data.auditLogs, deptNameById]);

  const filteredAccounts = useMemo(
    () =>
      unifiedAccounts.filter((row) => {
        if (groupFilter !== 'all' && row.group !== groupFilter) return false;
        if (deptFilter !== 'all' && row.departmentId !== deptFilter) return false;
        if (statusFilter !== 'all' && row.accountStatus !== statusFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          return (
            row.displayName.toLowerCase().includes(q) ||
            row.identifier.toLowerCase().includes(q) ||
            row.departmentName.toLowerCase().includes(q) ||
            row.roleLabel.toLowerCase().includes(q)
          );
        }
        return true;
      }),
    [unifiedAccounts, groupFilter, deptFilter, statusFilter, search]
  );

  const selectableAccountRows = useMemo(
    () =>
      filteredAccounts.filter(
        (row): row is UnifiedAccountRow & { userDoc: UserProfile } =>
          Boolean(row.userDoc && row.userDoc.uid !== firebaseUser?.uid)
      ),
    [filteredAccounts, firebaseUser?.uid]
  );

  const selectedBulkTargets = useMemo(() => {
    const seen = new Set<string>();
    const targets: { user: UserProfile; identifier?: string; departmentName?: string }[] = [];
    for (const row of unifiedAccounts) {
      if (
        row.userDoc &&
        row.userDoc.uid !== firebaseUser?.uid &&
        selectedUserIds.has(row.userDoc.id) &&
        !seen.has(row.userDoc.id)
      ) {
        seen.add(row.userDoc.id);
        targets.push({
          user: row.userDoc,
          identifier: row.identifier,
          departmentName: row.departmentName,
        });
      }
    }
    return targets;
  }, [unifiedAccounts, selectedUserIds, firebaseUser?.uid]);

  const allVisibleAccountsSelected =
    selectableAccountRows.length > 0 &&
    selectableAccountRows.every((r) => selectedUserIds.has(r.userDoc.id));

  const someVisibleAccountsSelected =
    selectableAccountRows.some((r) => selectedUserIds.has(r.userDoc.id)) && !allVisibleAccountsSelected;

  const toggleAccountSelection = (userId: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleSelectAllVisibleAccounts = () => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (allVisibleAccountsSelected) {
        selectableAccountRows.forEach((r) => next.delete(r.userDoc.id));
      } else {
        selectableAccountRows.forEach((r) => next.add(r.userDoc.id));
      }
      return next;
    });
  };

  const handleOpenBulkRoleModal = () => {
    if (!isSuperAdmin || selectedBulkTargets.length === 0) return;
    const updatableCount = selectedBulkTargets.filter((t) => t.user.role !== bulkTargetRole).length;
    if (updatableCount === 0) {
      showToast(
        `All ${selectedBulkTargets.length} selected account(s) already hold the ${ROLE_LABELS[bulkTargetRole]} role.`,
        'info'
      );
      return;
    }
    setBulkConfirmOpen(true);
  };

  const handleConfirmBulkUserRoles = async (reason: string) => {
    if (!firebaseUser || !profile || !isSuperAdmin || selectedBulkTargets.length === 0) return;
    setSavingBulkRole(true);
    try {
      const { updatedCount, skippedCount } = await bulkUpdateUserRoles(
        selectedBulkTargets.map((t) => t.user),
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
      setSelectedUserIds(new Set());
      setBulkConfirmOpen(false);
    } finally {
      setSavingBulkRole(false);
    }
  };

  const summaryCounts = useMemo(
    () => ({
      total: unifiedAccounts.length,
      students: unifiedAccounts.filter((r) => r.group === 'student').length,
      lecturers: unifiedAccounts.filter((r) => r.group === 'lecturer').length,
      adminsStaff: unifiedAccounts.filter((r) => r.group === 'staff_admin').length,
      pendingActivation: unifiedAccounts.filter((r) => r.accountStatus === 'Pending Activation').length,
    }),
    [unifiedAccounts]
  );

  const selectedUserLogs = useMemo(() => {
    if (!activityTarget) return [];
    return data.auditLogs
      .filter(
        (l) =>
          (activityTarget.userDoc?.uid && l.actorUid === activityTarget.userDoc.uid) ||
          l.actorName.toLowerCase() === activityTarget.displayName.toLowerCase() ||
          l.details.includes(activityTarget.identifier)
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [activityTarget, data.auditLogs]);

  const handleCreateRoleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    const emailClean = inviteEmail.trim().toLowerCase();
    const id = emailClean.replace(/[^a-z0-9]/g, '_');
    try {
      await setDoc(doc(db, 'role_invites', id), {
        email: emailClean,
        role: inviteRole,
        departmentId: inviteDeptId || '',
        assignedBy: clampStr(profile.displayName, 128),
        createdAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'ROLE_INVITE_ISSUED',
        `role_invites/${id}`,
        `Pre-assigned role ${inviteRole} to ${emailClean}.`,
        {
          newRole: inviteRole,
          targetName: emailClean,
        }
      );
      showToast(`Assigned ${ROLE_LABELS[inviteRole]} invite to ${emailClean}.`, 'success');
      setInviteEmail('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `role_invites/${id}`);
    }
  };

  const handleRequestUserRoleChange = (
    u: UserProfile,
    nextRole: UserRole,
    identifier?: string,
    departmentName?: string
  ) => {
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    if (u.uid === firebaseUser.uid) {
      showToast('You cannot demote your own active Super Administrator account. Use Portal Role Preview in the sidebar to test other roles.', 'error');
      return;
    }
    if (u.role === nextRole) return;
    setPendingRoleChange({ user: u, nextRole, identifier, departmentName });
  };

  const handleConfirmUserRoleChange = async (reason: string) => {
    if (!firebaseUser || !profile || !isSuperAdmin || !pendingRoleChange) return;
    const { user: u, nextRole } = pendingRoleChange;
    setSavingRole(true);
    try {
      await updateDoc(doc(db, 'users', u.id), {
        role: nextRole,
        updatedAt: new Date().toISOString(),
      });
      const cleanReason = clampStr(reason, 240);
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'USER_ROLE_CHANGED',
        `users/${u.id}`,
        cleanReason
          ? `Changed ${u.displayName} role from ${u.role} to ${nextRole}. Reason: ${cleanReason}`
          : `Changed ${u.displayName} role from ${u.role} to ${nextRole}.`,
        {
          previousRole: u.role,
          newRole: nextRole,
          targetUid: u.uid,
          targetName: u.displayName,
          reason: cleanReason,
        }
      );
      showToast(`Updated ${u.displayName} to ${ROLE_LABELS[nextRole]}.`, 'success');
      setPendingRoleChange(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.id}`);
    } finally {
      setSavingRole(false);
    }
  };

  const handleToggleUserSuspend = async (row: UnifiedAccountRow) => {
    if (!firebaseUser || !profile || !isSuperAdmin || !row.userDoc) return;
    const nextStatus = row.userDoc.status === 'suspended' ? 'active' : 'suspended';
    try {
      await updateDoc(doc(db, 'users', row.userDoc.id), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        nextStatus === 'suspended' ? 'USER_ACCOUNT_SUSPENDED' : 'USER_ACCOUNT_REACTIVATED',
        `users/${row.userDoc.id}`,
        `Set portal account status for ${row.displayName} (${row.identifier}) to ${nextStatus}.`,
        {
          previousRole: row.userDoc.role,
          newRole: row.userDoc.role,
          targetUid: row.userDoc.uid,
          targetName: row.displayName,
        }
      );
      showToast(
        `${row.displayName} is now ${nextStatus === 'suspended' ? 'Suspended' : 'Active'}.`,
        nextStatus === 'suspended' ? 'info' : 'success'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${row.userDoc.id}`);
    }
  };

  const handleActivateStudentAccount = async (row: UnifiedAccountRow) => {
    if (!firebaseUser || !profile || !isSuperAdmin || !row.studentId) return;
    const now = new Date().toISOString();
    try {
      await updateDoc(doc(db, 'students', row.studentId), {
        accountActivated: true,
        activatedAt: now,
        updatedAt: now,
      });
      if (row.admissionNo) {
        try {
          await updateDoc(doc(db, 'portal_bindings', sanitizeId(row.admissionNo.toUpperCase())), {
            activated: true,
            activatedAt: now,
          });
        } catch {
          // Ignore if binding doesn't exist
        }
      }
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENT_ACCOUNT_ADMIN_ACTIVATED',
        `students/${row.studentId}`,
        `Super Admin activated newly issued student account for ${row.displayName} (${row.identifier}).`
      );
      showToast(`Activated account for ${row.displayName}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `students/${row.studentId}`);
    }
  };

  const handleResetStudentBinding = async (row: UnifiedAccountRow) => {
    if (!firebaseUser || !profile || !isSuperAdmin || !row.studentId || !row.admissionNo) return;
    const bindingId = sanitizeId(row.admissionNo.toUpperCase());
    try {
      await updateDoc(doc(db, 'portal_bindings', bindingId), { boundUid: '' });
      await updateDoc(doc(db, 'students', row.studentId), { uid: '', updatedAt: new Date().toISOString() });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENT_LOGIN_BINDING_RESET',
        `portal_bindings/${bindingId}`,
        `Reset portal binding for ${row.admissionNo}.`
      );
      showToast(`Reset login binding for ${row.admissionNo}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `portal_bindings/${bindingId}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Institutional Account Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Accounts', val: summaryCounts.total, accent: 'text-slate-900 dark:text-white' },
          { label: 'Students', val: summaryCounts.students, accent: 'text-amber-600 dark:text-amber-400' },
          { label: 'Lecturers', val: summaryCounts.lecturers, accent: 'text-blue-600 dark:text-blue-400' },
          { label: 'Admins & Staff', val: summaryCounts.adminsStaff, accent: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Pending Activation', val: summaryCounts.pendingActivation, accent: 'text-amber-600 dark:text-amber-400' },
        ].map((card) => (
          <div
            key={card.label}
            className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4"
          >
            <p className="text-xs text-slate-500 dark:text-slate-400">{card.label}</p>
            <p className={`text-2xl font-bold font-mono tabular-nums mt-1 ${card.accent}`}>{card.val}</p>
          </div>
        ))}
      </div>

      {/* Filter Toolbar & Quick Actions */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          <div className="relative min-w-[200px] flex-1 max-w-xs">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, reg/staff no, dept..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
          </div>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value as typeof groupFilter)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            <option value="all">All Account Groups</option>
            <option value="student">Students</option>
            <option value="lecturer">Lecturers</option>
            <option value="staff_admin">Admins &amp; Other Staff</option>
          </select>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            <option value="all">All Departments</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
          >
            <option value="all">All Statuses</option>
            <option value="Active">Active</option>
            <option value="Pending Activation">Pending Activation</option>
            <option value="Suspended">Suspended</option>
          </select>
        </div>

        {isSuperAdmin && (
          <button
            type="button"
            onClick={onOpenBulkImport}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>Bulk Register Students (.xlsx)</span>
          </button>
        )}
      </div>

      {/* Main Split: Invite Form + Institutional Directory Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {isSuperAdmin && (
          <form
            onSubmit={handleCreateRoleInvite}
            className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3.5 self-start"
          >
            <div className="flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Pre-Provision Staff / Admin Invite</h3>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              When the invited Google email signs in, Firestore security rules verify and grant this role and department automatically.
            </p>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="staff.member@gmail.com"
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as Exclude<UserRole, 'applicant'>)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              {(Object.keys(ROLE_LABELS) as UserRole[])
                .filter((r) => r !== 'applicant')
                .map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
            </select>
            <select
              value={inviteDeptId}
              onChange={(e) => setInviteDeptId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="">All / Central Administration</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="w-full px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              Issue Role Invite
            </button>
          </form>
        )}

        <div
          className={`${
            isSuperAdmin ? 'lg:col-span-8' : 'lg:col-span-12'
          } border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto`}
        >
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold">
                Institutional User Accounts ({filteredAccounts.length})
              </h3>
            </div>
          </div>

          {isSuperAdmin && selectedBulkTargets.length > 0 && (
            <div className="px-5 py-3 border-b border-amber-500/30 bg-amber-500/5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
                  {selectedBulkTargets.length} selected
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedUserIds(new Set())}
                  className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white underline underline-offset-2 whitespace-nowrap shrink-0"
                >
                  Clear Selection
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Target role for selected accounts"
                  value={bulkTargetRole}
                  onChange={(e) => setBulkTargetRole(e.target.value as UserRole)}
                  className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleOpenBulkRoleModal}
                  className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 transition-colors whitespace-nowrap shrink-0"
                >
                  Update Selected Roles ({selectedBulkTargets.length})
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
                      aria-label="Select all selectable visible accounts"
                      checked={allVisibleAccountsSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someVisibleAccountsSelected;
                      }}
                      disabled={selectableAccountRows.length === 0}
                      onChange={toggleSelectAllVisibleAccounts}
                      className="rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500 disabled:opacity-40"
                    />
                  </th>
                )}
                <th className="py-3 px-4 font-medium">User &amp; ID</th>
                <th className="py-3 px-4 font-medium">Department &amp; Role</th>
                <th className="py-3 px-4 font-medium">Account Status</th>
                <th className="py-3 px-4 font-medium">Recent Activity</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredAccounts.map((row) => {
                const canBulkSelect = Boolean(row.userDoc && row.userDoc.uid !== firebaseUser?.uid);
                const isSelected = Boolean(row.userDoc && selectedUserIds.has(row.userDoc.id));
                return (
                <tr
                  key={row.rowId}
                  className={
                    isSelected
                      ? 'bg-amber-500/5 hover:bg-amber-500/10'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }
                >
                  {isSuperAdmin && (
                    <td className="py-3 pl-4 pr-2 align-middle">
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.displayName}`}
                        disabled={!canBulkSelect}
                        checked={isSelected}
                        onChange={() => row.userDoc && toggleAccountSelection(row.userDoc.id)}
                        title={
                          !row.userDoc
                            ? 'No linked portal user account yet'
                            : row.userDoc.uid === firebaseUser?.uid
                            ? 'Your own Super Admin account is protected'
                            : `Select ${row.displayName}`
                        }
                        className="rounded border-slate-300 dark:border-slate-700 text-amber-600 focus:ring-amber-500 disabled:opacity-30 disabled:cursor-not-allowed"
                      />
                    </td>
                  )}
                  <td className="py-3 px-4">
                    <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{row.displayName}</p>
                    <p className="font-mono text-amber-600 dark:text-amber-400">{row.identifier}</p>
                  </td>
                  <td className="py-3 px-4 space-y-1">
                    <p className="font-medium text-slate-800 dark:text-slate-200">{row.departmentName}</p>
                    {isSuperAdmin && row.userDoc ? (
                      row.userDoc.uid === firebaseUser?.uid ? (
                        <p className="font-semibold text-amber-600 dark:text-amber-400">
                          {ROLE_LABELS[row.userDoc.role]} (Protected)
                        </p>
                      ) : (
                        <select
                          value={row.userDoc.role}
                          onChange={(e) =>
                            handleRequestUserRoleChange(
                              row.userDoc!,
                              e.target.value as UserRole,
                              row.identifier,
                              row.departmentName
                            )
                          }
                          className="px-2 py-1 text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                        >
                          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      )
                    ) : (
                      <p className="text-slate-500 dark:text-slate-400">{row.roleLabel}</p>
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <span
                      className={`font-semibold ${
                        row.accountStatus === 'Active'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : row.accountStatus === 'Pending Activation'
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {row.accountStatus}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-mono text-[11px] text-slate-700 dark:text-slate-300">{row.latestAction}</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                      {new Date(row.lastActivityAt).toLocaleDateString('en-KE')} · {row.activityCount} events
                    </p>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-1.5">
                    <button
                      type="button"
                      onClick={() => setActivityTarget(row)}
                      title="Inspect account activity"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200"
                    >
                      <Activity className="w-3 h-3 text-amber-500" />
                      <span>Activity</span>
                    </button>
                    {isSuperAdmin && row.studentId && row.accountStatus === 'Pending Activation' && (
                      <button
                        type="button"
                        onClick={() => handleActivateStudentAccount(row)}
                        title="Activate student account"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Activate</span>
                      </button>
                    )}
                    {isSuperAdmin && row.studentId && row.admissionNo && (
                      <button
                        type="button"
                        onClick={() => handleResetStudentBinding(row)}
                        title="Reset portal login binding"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:border-amber-500"
                      >
                        <KeyRound className="w-3 h-3 text-slate-400" />
                      </button>
                    )}
                    {isSuperAdmin && row.userDoc && row.userDoc.uid !== firebaseUser?.uid && (
                      <button
                        type="button"
                        onClick={() => handleToggleUserSuspend(row)}
                        title={row.userDoc.status === 'suspended' ? 'Reactivate user' : 'Suspend user'}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border ${
                          row.userDoc.status === 'suspended'
                            ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400'
                            : 'border-red-500/30 text-red-600 dark:text-red-400'
                        }`}
                      >
                        {row.userDoc.status === 'suspended' ? (
                          <>
                            <UserCheck className="w-3 h-3" />
                            <span>Restore</span>
                          </>
                        ) : (
                          <>
                            <UserX className="w-3 h-3" />
                            <span>Suspend</span>
                          </>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
                );
              })}
              {filteredAccounts.length === 0 && (
                <tr>
                  <td colSpan={isSuperAdmin ? 6 : 5} className="py-8 text-center text-slate-500">
                    No accounts match the selected filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-User Account Activity Modal */}
      {activityTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
        >
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Account Activity — {activityTarget.displayName}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  {activityTarget.identifier} · {activityTarget.departmentName} · {activityTarget.accountStatus}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActivityTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800">
              {selectedUserLogs.length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No recorded audit events yet for {activityTarget.displayName}. Last update:{' '}
                  {new Date(activityTarget.lastActivityAt).toLocaleString('en-KE')}.
                </p>
              ) : (
                selectedUserLogs.map((log) => (
                  <div key={log.id} className="py-3 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{log.action}</span>
                      <span className="font-mono text-slate-500 tabular-nums">
                        {new Date(log.createdAt).toLocaleString('en-KE')}
                      </span>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300">{log.details}</p>
                    <p className="text-[11px] font-mono text-slate-500">{log.entityPath}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <RoleChangeConfirmModal
        open={Boolean(pendingRoleChange)}
        targetUser={pendingRoleChange?.user ?? null}
        nextRole={pendingRoleChange?.nextRole ?? null}
        linkedIdentifier={pendingRoleChange?.identifier}
        linkedDepartment={pendingRoleChange?.departmentName}
        loading={savingRole}
        onConfirm={handleConfirmUserRoleChange}
        onCancel={() => !savingRole && setPendingRoleChange(null)}
      />

      <BulkRoleChangeConfirmModal
        open={bulkConfirmOpen}
        targets={selectedBulkTargets}
        nextRole={bulkTargetRole}
        loading={savingBulkRole}
        onConfirm={handleConfirmBulkUserRoles}
        onCancel={() => !savingBulkRole && setBulkConfirmOpen(false)}
      />
    </div>
  );
}
