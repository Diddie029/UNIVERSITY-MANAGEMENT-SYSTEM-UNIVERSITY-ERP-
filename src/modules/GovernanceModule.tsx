import React, { useState } from 'react';
import { updateDoc, doc } from 'firebase/firestore';
import {
  Activity,
  BookOpenCheck,
  Building2,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { CurriculumManagerPanel } from '../components/CurriculumManagerPanel';
import { LecturerAssignmentPanel } from '../components/LecturerAssignmentPanel';
import { UserAccountsPanel } from '../components/UserAccountsPanel';
import { UserRoleManagementPanel } from '../components/UserRoleManagementPanel';
import { AuditLogsPanel } from '../components/AuditLogsPanel';
import { SystemHealthPanel } from '../components/SystemHealthPanel';
import { BulkStudentImportModal } from '../components/BulkStudentImportModal';
import { ErpDataset } from '../hooks/useErpData';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';

interface GovernanceModuleProps {
  data: ErpDataset;
}

export function GovernanceModule({ data }: GovernanceModuleProps) {
  const { actualRole, effectiveRole } = useAuth();
  const { showToast } = useToast();
  const isSuperAdmin = actualRole === 'super_admin' && effectiveRole === 'super_admin';

  const [tab, setTab] = useState<'structure' | 'lecturers' | 'roles' | 'users' | 'health' | 'audit'>('structure');
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

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

  const tabs: {
    id: typeof tab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'structure', label: 'Depts, Courses & Units', icon: Building2 },
    { id: 'lecturers', label: 'Lecturer Assignments', icon: BookOpenCheck },
    { id: 'roles', label: `User Roles (${data.users.length})`, icon: ShieldCheck },
    { id: 'users', label: `Active Accounts (${data.users.length + data.students.length})`, icon: Users },
    { id: 'health', label: 'System Health', icon: Activity },
    { id: 'audit', label: `Audit Logs (${data.auditLogs.length})`, icon: ShieldAlert },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col 2xl:flex-row 2xl:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            Super Admin Governance, Curriculum &amp; System Health
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Manage departments, course durations, Year.Semester units, lecturer assignments, bulk student onboarding, institutional accounts, and live system telemetry.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {tabs.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB 1: Departments, Courses, Duration & Year.Semester Units */}
      {tab === 'structure' && (
        <div className="space-y-6">
          {/* Academic Calendar Controls */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Academic Calendar Controls</h3>
            {data.calendars.map((cal) => (
              <div
                key={cal.id}
                className="flex flex-wrap items-center justify-between gap-4 py-2 border-t border-slate-200 dark:border-slate-800 first:border-t-0"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {cal.academicYear} · {cal.semesterName}
                  </p>
                  <p className="text-xs text-slate-500 tabular-nums">
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

          <CurriculumManagerPanel data={data} isSuperAdmin={isSuperAdmin} />
        </div>
      )}

      {/* TAB 2: Lecturer & Unit Assignment */}
      {tab === 'lecturers' && (
        <LecturerAssignmentPanel data={data} isSuperAdmin={isSuperAdmin} />
      )}

      {/* TAB 3: Safe User Role & Access Management */}
      {tab === 'roles' && (
        <UserRoleManagementPanel data={data} isSuperAdmin={isSuperAdmin} />
      )}

      {/* TAB 4: Institutional User Account Management + Bulk Student Onboarding */}
      {tab === 'users' && (
        <UserAccountsPanel
          data={data}
          isSuperAdmin={isSuperAdmin}
          onOpenBulkImport={() => setBulkImportOpen(true)}
        />
      )}

      {/* TAB 4: System Health, DB Connectivity & Logs */}
      {tab === 'health' && <SystemHealthPanel data={data} />}

      {/* TAB 6: Immutable Audit Logs & Permission Tracking */}
      {tab === 'audit' && <AuditLogsPanel data={data} isSuperAdmin={isSuperAdmin} />}

      <BulkStudentImportModal
        open={bulkImportOpen}
        data={data}
        onClose={() => setBulkImportOpen(false)}
      />
    </div>
  );
}
