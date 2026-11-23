import React, { useMemo, useState } from 'react';
import { doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { BookOpenCheck, Plus, Search, UserCheck, UserMinus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { ErpDataset } from '../hooks/useErpData';
import {
  clampStr,
  db,
  handleFirestoreError,
  hashVerificationKey,
  makeId,
  OperationType,
  sanitizeId,
} from '../lib/firebase';
import { recordAuditLog } from '../lib/erpService';
import { Course } from '../types/erp';

interface LecturerAssignmentPanelProps {
  data: ErpDataset;
  isSuperAdmin: boolean;
}

interface LecturerOption {
  key: string;
  employeeId?: string;
  staffNo: string;
  uid?: string;
  fullName: string;
  jobTitle: string;
  departmentId: string;
  departmentName: string;
}

export function LecturerAssignmentPanel({ data, isSuperAdmin }: LecturerAssignmentPanelProps) {
  const { firebaseUser, profile } = useAuth();
  const { showToast } = useToast();

  const [deptFilter, setDeptFilter] = useState('all');
  const [progFilter, setProgFilter] = useState('all');
  const [assignFilter, setAssignFilter] = useState<'all' | 'assigned' | 'unassigned'>('all');
  const [search, setSearch] = useState('');
  const [savingCourseId, setSavingCourseId] = useState<string | null>(null);

  // Quick Add Lecturer form
  const [showAddLecturer, setShowAddLecturer] = useState(false);
  const [lecName, setLecName] = useState('');
  const [lecEmail, setLecEmail] = useState('');
  const [lecStaffNo, setLecStaffNo] = useState('');
  const [lecDeptId, setLecDeptId] = useState('');
  const [lecTitle, setLecTitle] = useState('Lecturer');
  const [lecPasscode, setLecPasscode] = useState('');
  const [creatingLec, setCreatingLec] = useState(false);

  const deptNameById = useMemo(
    () => new Map(data.departments.map((d) => [d.id, d.name])),
    [data.departments]
  );

  // Build unified lecturer roster across HR employees + portal academic users
  const lecturers: LecturerOption[] = useMemo(() => {
    const map = new Map<string, LecturerOption>();

    for (const emp of data.employees) {
      const titleLower = emp.jobTitle.toLowerCase();
      const linkedUser = data.users.find((u) => u.employeeId === emp.id || (emp.uid && u.uid === emp.uid));
      const isAcademic =
        titleLower.includes('lecturer') ||
        titleLower.includes('professor') ||
        titleLower.includes('dean') ||
        titleLower.includes('hod') ||
        titleLower.includes('head of department') ||
        titleLower.includes('tutor') ||
        titleLower.includes('instructor') ||
        (linkedUser && ['lecturer', 'hod', 'exam_officer'].includes(linkedUser.role));

      if (isAcademic || emp.status === 'Active') {
        map.set(`emp_${emp.id}`, {
          key: `emp_${emp.id}`,
          employeeId: emp.id,
          staffNo: emp.staffNo,
          uid: emp.uid || linkedUser?.uid || '',
          fullName: emp.fullName,
          jobTitle: emp.jobTitle,
          departmentId: emp.departmentId,
          departmentName: emp.departmentName || deptNameById.get(emp.departmentId) || 'Academic Dept',
        });
      }
    }

    for (const u of data.users) {
      if (!['lecturer', 'hod', 'exam_officer'].includes(u.role)) continue;
      const alreadyLinked = Array.from(map.values()).some(
        (l) => (l.uid && l.uid === u.uid) || (u.employeeId && l.employeeId === u.employeeId)
      );
      if (!alreadyLinked) {
        map.set(`usr_${u.uid}`, {
          key: `usr_${u.uid}`,
          employeeId: u.employeeId,
          staffNo: u.employeeId || u.uid.slice(0, 10),
          uid: u.uid,
          fullName: u.displayName,
          jobTitle: u.role === 'hod' ? 'Head of Department' : u.role === 'exam_officer' ? 'Exam Officer' : 'Lecturer',
          departmentId: u.departmentId || '',
          departmentName: deptNameById.get(u.departmentId || '') || 'Unassigned Dept',
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [data.employees, data.users, deptNameById]);

  const filteredLecturers = useMemo(
    () =>
      lecturers.filter((l) => {
        const matchDept = deptFilter === 'all' || l.departmentId === deptFilter;
        const matchSearch =
          !search.trim() ||
          l.fullName.toLowerCase().includes(search.toLowerCase()) ||
          l.staffNo.toLowerCase().includes(search.toLowerCase()) ||
          l.departmentName.toLowerCase().includes(search.toLowerCase());
        return matchDept && matchSearch;
      }),
    [lecturers, deptFilter, search]
  );

  const filteredCourses = useMemo(
    () =>
      data.courses.filter((c) => {
        const matchDept = deptFilter === 'all' || c.departmentId === deptFilter;
        const matchProg = progFilter === 'all' || c.programmeId === progFilter;
        const isAssigned = Boolean(c.lecturerUid || c.lecturerEmployeeId || (c.lecturerName && c.lecturerName !== 'Unassigned'));
        const matchAssign =
          assignFilter === 'all' ||
          (assignFilter === 'assigned' && isAssigned) ||
          (assignFilter === 'unassigned' && !isAssigned);
        const matchSearch =
          !search.trim() ||
          c.code.toLowerCase().includes(search.toLowerCase()) ||
          c.title.toLowerCase().includes(search.toLowerCase()) ||
          (c.lecturerName || '').toLowerCase().includes(search.toLowerCase());
        return matchDept && matchProg && matchAssign && matchSearch;
      }),
    [data.courses, deptFilter, progFilter, assignFilter, search]
  );

  const handleAssignLecturer = async (course: Course, selectedKey: string) => {
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    setSavingCourseId(course.id);
    const now = new Date().toISOString();
    try {
      if (!selectedKey) {
        await updateDoc(doc(db, 'courses', course.id), {
          lecturerUid: '',
          lecturerEmployeeId: '',
          lecturerStaffNo: '',
          lecturerName: 'Unassigned',
          updatedAt: now,
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'LECTURER_UNIT_UNASSIGNED',
          `courses/${course.id}`,
          `Cleared lecturer assignment for unit ${course.code} — ${course.title}.`
        );
        showToast(`Cleared lecturer from ${course.code}.`, 'info');
      } else {
        const lec = lecturers.find((l) => l.key === selectedKey);
        if (!lec) return;
        await updateDoc(doc(db, 'courses', course.id), {
          lecturerUid: lec.uid || '',
          lecturerEmployeeId: lec.employeeId || '',
          lecturerStaffNo: lec.staffNo || '',
          lecturerName: clampStr(lec.fullName, 120),
          updatedAt: now,
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'LECTURER_UNIT_ASSIGNED',
          `courses/${course.id}`,
          `Assigned unit ${course.code} (${course.title}) to ${lec.fullName} (${lec.staffNo}).`
        );
        showToast(`Assigned ${course.code} to ${lec.fullName}.`, 'success');
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `courses/${course.id}`);
    } finally {
      setSavingCourseId(null);
    }
  };

  const handleCreateLecturer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    const deptId = lecDeptId || data.departments[0]?.id || '';
    const dept = data.departments.find((d) => d.id === deptId);
    if (!dept) {
      showToast('Create a department first.', 'error');
      return;
    }
    const staffNo = (
      clampStr(lecStaffNo, 64) || `EDU-STF-${String(data.employees.length + 101).padStart(4, '0')}`
    ).toUpperCase();
    const cleanPasscode = clampStr(lecPasscode, 32) || staffNo.replace(/[^A-Z0-9]/g, '').slice(-7);
    const empId = makeId('emp');
    const now = new Date().toISOString();
    const verificationHash = await hashVerificationKey(cleanPasscode);

    setCreatingLec(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'employees', empId), {
        staffNo,
        fullName: clampStr(lecName, 160),
        email: clampStr(lecEmail || `${staffNo.toLowerCase()}@eduvance.ac.ke`, 200),
        departmentId: dept.id,
        departmentName: dept.name,
        jobTitle: clampStr(lecTitle, 120),
        employmentCategory: 'Permanent',
        basicSalary: 145000,
        houseAllowance: 35000,
        commuterAllowance: 14000,
        pensionContribution: 7500,
        status: 'Active',
        createdAt: now,
        updatedAt: now,
      });
      batch.set(doc(db, 'portal_bindings', sanitizeId(staffNo)), {
        code: staffNo,
        targetType: 'employee',
        targetId: empId,
        role: lecTitle.toLowerCase().includes('hod') ? 'hod' : 'lecturer',
        fullName: clampStr(lecName, 160),
        verificationHash,
        boundUid: '',
        activated: true,
        createdAt: now,
      });
      await batch.commit();
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'LECTURER_REGISTERED',
        `employees/${empId}`,
        `Registered ${lecName} (${staffNo}) under ${dept.name} with portal login passcode.`
      );
      showToast(`Added ${lecName} (${staffNo}). Passcode: ${cleanPasscode}`, 'success');
      setLecName('');
      setLecEmail('');
      setLecStaffNo('');
      setLecPasscode('');
      setShowAddLecturer(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `employees/${empId}`);
    } finally {
      setCreatingLec(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Filters & Add Lecturer Action */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="relative min-w-[210px] flex-1 max-w-xs">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search lecturer, unit code, or title..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="all">All Departments ({data.departments.length})</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
            <select
              value={progFilter}
              onChange={(e) => setProgFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="all">All Courses</option>
              {data.programmes
                .filter((p) => deptFilter === 'all' || p.departmentId === deptFilter)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
            </select>
            <select
              value={assignFilter}
              onChange={(e) => setAssignFilter(e.target.value as 'all' | 'assigned' | 'unassigned')}
              className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            >
              <option value="all">All Units ({data.courses.length})</option>
              <option value="unassigned">Unassigned Only</option>
              <option value="assigned">Assigned Only</option>
            </select>
          </div>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setShowAddLecturer((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showAddLecturer ? 'Close Form' : 'Register Lecturer'}</span>
            </button>
          )}
        </div>

        {isSuperAdmin && showAddLecturer && (
          <form onSubmit={handleCreateLecturer} className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Lecturer Full Name</label>
              <input
                type="text"
                required
                value={lecName}
                onChange={(e) => setLecName(e.target.value)}
                placeholder="e.g. Dr. Faith Wanjiru"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Department</label>
              <select
                value={lecDeptId || data.departments[0]?.id || ''}
                onChange={(e) => setLecDeptId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Staff No (Blank = Auto)</label>
              <input
                type="text"
                value={lecStaffNo}
                onChange={(e) => setLecStaffNo(e.target.value)}
                placeholder="EDU-STF-0301"
                className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Title &amp; Passcode</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={lecTitle}
                  onChange={(e) => setLecTitle(e.target.value)}
                  placeholder="Lecturer"
                  className="w-1/2 px-2.5 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
                <input
                  type="text"
                  value={lecPasscode}
                  onChange={(e) => setLecPasscode(e.target.value)}
                  placeholder="Passcode"
                  className="w-1/2 px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <input
                type="email"
                value={lecEmail}
                onChange={(e) => setLecEmail(e.target.value)}
                placeholder="Email"
                className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
              <button
                type="submit"
                disabled={creatingLec}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
              >
                {creatingLec ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Main Split: Lecturers Directory & Unit Assignment Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Available Lecturers across Departments */}
        <div className="lg:col-span-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden self-start">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Available Lecturers ({filteredLecturers.length})
              </h3>
            </div>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
            {filteredLecturers.map((lec) => {
              const assignedUnits = data.courses.filter(
                (c) =>
                  (lec.uid && c.lecturerUid === lec.uid) ||
                  (lec.employeeId && c.lecturerEmployeeId === lec.employeeId) ||
                  (lec.staffNo && c.lecturerStaffNo === lec.staffNo)
              );
              const totalCredits = assignedUnits.reduce((sum, u) => sum + (u.creditUnits || 0), 0);
              return (
                <div key={lec.key} className="p-4 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{lec.fullName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono text-amber-600 dark:text-amber-400">{lec.staffNo}</span> · {lec.jobTitle}
                      </p>
                    </div>
                    <span className="text-xs font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap">
                      {assignedUnits.length} units
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lec.departmentName} · <span className="tabular-nums">{totalCredits} Credit Hrs</span>
                  </p>
                  {assignedUnits.length > 0 && (
                    <p className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 truncate">
                      {assignedUnits.map((u) => u.code).join(', ')}
                    </p>
                  )}
                </div>
              );
            })}
            {filteredLecturers.length === 0 && (
              <p className="p-6 text-xs text-slate-500 text-center">No lecturers match the active department filter.</p>
            )}
          </div>
        </div>

        {/* Right: Course Unit Assignments */}
        <div className="lg:col-span-8 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-x-auto">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <BookOpenCheck className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Unit-to-Lecturer Assignments ({filteredCourses.length})
              </h3>
            </div>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 font-medium">Unit &amp; Yr.Sem</th>
                <th className="py-3 px-4 font-medium">Department</th>
                <th className="py-3 px-4 font-medium">Assigned Lecturer</th>
                <th className="py-3 px-4 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredCourses.map((course) => {
                const matchedLec = lecturers.find(
                  (l) =>
                    (course.lecturerEmployeeId && l.employeeId === course.lecturerEmployeeId) ||
                    (course.lecturerUid && l.uid === course.lecturerUid) ||
                    (course.lecturerStaffNo && l.staffNo === course.lecturerStaffNo) ||
                    (course.lecturerName && course.lecturerName !== 'Unassigned' && l.fullName === course.lecturerName)
                );
                const selectedVal = matchedLec?.key || '';
                const isBusy = savingCourseId === course.id;
                return (
                  <tr key={course.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-slate-900 dark:text-slate-100">
                        <span className="font-mono text-xs text-amber-600 dark:text-amber-400 mr-2">{course.code}</span>
                        {course.title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        Yr {course.yearLevel}.{course.semesterNumber} · {course.creditUnits} Credits
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">
                      {deptNameById.get(course.departmentId) || course.departmentId}
                    </td>
                    <td className="py-3 px-4">
                      {isSuperAdmin ? (
                        <select
                          disabled={isBusy}
                          value={selectedVal}
                          onChange={(e) => handleAssignLecturer(course, e.target.value)}
                          className="w-full max-w-[250px] px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                        >
                          <option value="">— Unassigned —</option>
                          {lecturers.map((l) => (
                            <option key={l.key} value={l.key}>
                              {l.fullName} ({l.staffNo} · {l.departmentName})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                          {course.lecturerName || 'Unassigned'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {selectedVal || (course.lecturerName && course.lecturerName !== 'Unassigned') ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                            <UserCheck className="w-3.5 h-3.5" />
                            <span>Assigned</span>
                          </span>
                          {isSuperAdmin && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleAssignLecturer(course, '')}
                              title="Unassign lecturer"
                              className="p-1 rounded text-slate-400 hover:text-red-500"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Unassigned</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredCourses.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-xs text-slate-500">
                    No course units match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
