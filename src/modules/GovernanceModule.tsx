import React, { useState } from 'react';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { FileSpreadsheet, Plus, Shield, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { recordAuditLog } from '../lib/erpService';
import { exportToCSV } from '../lib/pdfGenerator';
import { ROLE_LABELS, UserProfile, UserRole } from '../types/erp';

interface GovernanceModuleProps {
  data: ErpDataset;
}

export function GovernanceModule({ data }: GovernanceModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { showToast } = useToast();
  const isSuperAdmin = profile?.role === 'super_admin' && effectiveRole === 'super_admin';

  const [tab, setTab] = useState<'structure' | 'users' | 'audit'>('structure');

  // Academic Structure Forms
  const [facCode, setFacCode] = useState('');
  const [facName, setFacName] = useState('');
  const [progCode, setProgCode] = useState('');
  const [progName, setProgName] = useState('');
  const [progDeptId, setProgDeptId] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseProgId, setCourseProgId] = useState('');

  // Role Invite Form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<UserRole, 'applicant'>>('finance');

  const handleAddFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const id = makeId('fac');
    try {
      await setDoc(doc(db, 'faculties', id), {
        code: clampStr(facCode.toUpperCase(), 24),
        name: clampStr(facName, 160),
        deanName: '',
        createdAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'FACULTY_CREATED',
        `faculties/${id}`,
        `Created faculty ${facCode} — ${facName}`
      );
      showToast('Faculty created.', 'success');
      setFacCode('');
      setFacName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `faculties/${id}`);
    }
  };

  const handleAddProgramme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const deptId = progDeptId || data.departments[0]?.id;
    if (!deptId) {
      showToast('Create or seed departments first.', 'error');
      return;
    }
    const id = makeId('prog');
    try {
      await setDoc(doc(db, 'programmes', id), {
        code: clampStr(progCode.toUpperCase(), 32),
        name: clampStr(progName, 180),
        level: 'Degree',
        departmentId: deptId,
        durationYears: 4,
        minKcseGrade: 'C+',
        createdAt: new Date().toISOString(),
      });
      showToast(`Added programme ${progCode}.`, 'success');
      setProgCode('');
      setProgName('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `programmes/${id}`);
    }
  };

  const handleAddCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const prog = data.programmes.find((p) => p.id === (courseProgId || data.programmes[0]?.id));
    if (!prog) return;
    const id = makeId('crs');
    try {
      await setDoc(doc(db, 'courses', id), {
        code: clampStr(courseCode.toUpperCase(), 24),
        title: clampStr(courseTitle, 180),
        programmeId: prog.id,
        departmentId: prog.departmentId,
        yearLevel: 1,
        semesterNumber: 1,
        creditUnits: 3,
        lecturerUid: firebaseUser.uid,
        lecturerName: profile.displayName,
        schedule: 'Mon 10:00 - 13:00',
        room: 'Lecture Hall A',
        createdAt: new Date().toISOString(),
      });
      showToast(`Added course unit ${courseCode}.`, 'success');
      setCourseCode('');
      setCourseTitle('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `courses/${id}`);
    }
  };

  const handleToggleCalendarFlag = async (
    calId: string,
    field: 'registrationOpen' | 'marksEntryOpen',
    current: boolean
  ) => {
    try {
      await updateDoc(doc(db, 'academic_calendars', calId), {
        [field]: !current,
        updatedAt: new Date().toISOString(),
      });
      showToast(`Updated academic calendar ${field}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `academic_calendars/${calId}`);
    }
  };

  const handleCreateRoleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const emailClean = inviteEmail.trim().toLowerCase();
    const id = emailClean.replace(/[^a-z0-9]/g, '_');
    try {
      await setDoc(doc(db, 'role_invites', id), {
        email: emailClean,
        role: inviteRole,
        departmentId: '',
        assignedBy: clampStr(profile.displayName, 128),
        createdAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'ROLE_INVITE_ISSUED',
        `role_invites/${id}`,
        `Pre-assigned role ${inviteRole} to ${emailClean}.`
      );
      showToast(`Assigned ${ROLE_LABELS[inviteRole]} invite to ${emailClean}.`, 'success');
      setInviteEmail('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `role_invites/${id}`);
    }
  };

  const handleChangeUserRole = async (u: UserProfile, nextRole: UserRole) => {
    if (!firebaseUser || !profile) return;
    try {
      await updateDoc(doc(db, 'users', u.id), {
        role: nextRole,
        updatedAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'USER_ROLE_CHANGED',
        `users/${u.id}`,
        `Changed ${u.displayName} role from ${u.role} to ${nextRole}.`
      );
      showToast(`Updated ${u.displayName} to ${ROLE_LABELS[nextRole]}.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${u.id}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            University Governance, RBAC &amp; Audit Trail
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Configure faculties, programmes, courses, academic calendars, staff role permissions, and inspect immutable audit logs.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setTab('structure')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${
              tab === 'structure'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Academic Structure
          </button>
          <button
            type="button"
            onClick={() => setTab('users')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${
              tab === 'users'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Users &amp; Permissions
          </button>
          <button
            type="button"
            onClick={() => setTab('audit')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${
              tab === 'audit'
                ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Audit Logs ({data.auditLogs.length})
          </button>
        </div>
      </div>

      {/* TAB 1: Structure & Calendar */}
      {tab === 'structure' && (
        <div className="space-y-6">
          {/* Academic Calendar Controls */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3">
            <h3 className="text-sm font-semibold">Academic Calendar Controls</h3>
            {data.calendars.map((cal) => (
              <div
                key={cal.id}
                className="flex flex-wrap items-center justify-between gap-4 py-2 border-t border-slate-200 dark:border-slate-800 first:border-t-0"
              >
                <div>
                  <p className="text-sm font-semibold">
                    {cal.academicYear} · {cal.semesterName}
                  </p>
                  <p className="text-xs text-slate-500">
                    {cal.startDate} to {cal.endDate}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!isSuperAdmin}
                    onClick={() => handleToggleCalendarFlag(cal.id, 'registrationOpen', cal.registrationOpen)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                      cal.registrationOpen
                        ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                        : 'border-slate-300 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    Course Reg: {cal.registrationOpen ? 'Open' : 'Closed'}
                  </button>
                  <button
                    type="button"
                    disabled={!isSuperAdmin}
                    onClick={() => handleToggleCalendarFlag(cal.id, 'marksEntryOpen', cal.marksEntryOpen)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                      cal.marksEntryOpen
                        ? 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                        : 'border-slate-300 dark:border-slate-700 text-slate-500'
                    }`}
                  >
                    Marks Entry: {cal.marksEntryOpen ? 'Open' : 'Closed'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {isSuperAdmin && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <form onSubmit={handleAddFaculty} className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3">
                <h4 className="text-sm font-semibold">Add Faculty</h4>
                <input type="text" required placeholder="Code (e.g. FENG)" value={facCode} onChange={(e) => setFacCode(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                <input type="text" required placeholder="Faculty Name" value={facName} onChange={(e) => setFacName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                <button type="submit" className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Faculty</span>
                </button>
              </form>

              <form onSubmit={handleAddProgramme} className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3">
                <h4 className="text-sm font-semibold">Add Programme</h4>
                <input type="text" required placeholder="Code (e.g. BSC-IT)" value={progCode} onChange={(e) => setProgCode(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                <input type="text" required placeholder="Programme Title" value={progName} onChange={(e) => setProgName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                <select value={progDeptId || data.departments[0]?.id || ''} onChange={(e) => setProgDeptId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                  {data.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <button type="submit" className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Programme</span>
                </button>
              </form>

              <form onSubmit={handleAddCourse} className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3">
                <h4 className="text-sm font-semibold">Add Course Unit</h4>
                <input type="text" required placeholder="Code (e.g. CSC 305)" value={courseCode} onChange={(e) => setCourseCode(e.target.value)} className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                <input type="text" required placeholder="Course Title" value={courseTitle} onChange={(e) => setCourseTitle(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900" />
                <select value={courseProgId || data.programmes[0]?.id || ''} onChange={(e) => setCourseProgId(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900">
                  {data.programmes.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
                </select>
                <button type="submit" className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Course</span>
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: Users & Role Invites */}
      {tab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {isSuperAdmin && (
            <form
              onSubmit={handleCreateRoleInvite}
              className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4 self-start"
            >
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold">Pre-Provision Staff / Role Invite</h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                When the invited Google email signs in, Firestore security rules automatically verify and grant this role.
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
              <button
                type="submit"
                className="w-full px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                Issue Role Invite
              </button>
            </form>
          )}

          <div className={`${isSuperAdmin ? 'lg:col-span-8' : 'lg:col-span-12'} border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto`}>
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Registered Portal Accounts ({data.users.length})</h3>
            </div>
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">User Name</th>
                  <th className="py-3 px-4 font-medium">UID</th>
                  <th className="py-3 px-4 font-medium">Assigned Role</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {data.users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-3 px-4 font-medium">{u.displayName}</td>
                    <td className="py-3 px-4 font-mono text-xs text-slate-500">{u.uid.slice(0, 14)}...</td>
                    <td className="py-3 px-4">
                      {isSuperAdmin ? (
                        <select
                          value={u.role}
                          onChange={(e) => handleChangeUserRole(u, e.target.value as UserRole)}
                          className="px-2.5 py-1 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                        >
                          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs font-medium">{ROLE_LABELS[u.role]}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: Immutable Audit Logs */}
      {tab === 'audit' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() =>
                exportToCSV(
                  'PUST_Audit_Logs.csv',
                  ['Timestamp', 'Actor', 'Role', 'Action', 'Entity', 'Details'],
                  data.auditLogs.map((l) => [l.createdAt, l.actorName, l.actorRole, l.action, l.entityPath, l.details])
                )
              }
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827]"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-amber-500" />
              <span>Export Audit CSV</span>
            </button>
          </div>
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 font-medium">Timestamp</th>
                  <th className="py-3 px-4 font-medium">Actor</th>
                  <th className="py-3 px-4 font-medium">Action</th>
                  <th className="py-3 px-4 font-medium">Audit Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {[...data.auditLogs]
                  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                  .map((log) => (
                    <tr key={log.id}>
                      <td className="py-3 px-4 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('en-KE')}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <span className="font-semibold text-slate-900 dark:text-slate-100">{log.actorName}</span>
                        <span className="block text-slate-500">{log.actorRole}</span>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-amber-600 dark:text-amber-400">
                        {log.action}
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">{log.details}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
