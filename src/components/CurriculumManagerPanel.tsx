import React, { useEffect, useMemo, useState } from 'react';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import {
  BookOpen,
  Building2,
  CheckCircle2,
  Edit3,
  FolderPlus,
  GraduationCap,
  Layers,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { recordAuditLog } from '../lib/erpService';
import { Course, Department, Programme } from '../types/erp';

interface CurriculumManagerPanelProps {
  data: ErpDataset;
  isSuperAdmin: boolean;
}

export function CurriculumManagerPanel({ data, isSuperAdmin }: CurriculumManagerPanelProps) {
  const { firebaseUser, profile } = useAuth();
  const { showToast } = useToast();

  // Active hierarchy selection
  const [selectedDeptId, setSelectedDeptId] = useState<string>('');
  const [selectedProgId, setSelectedProgId] = useState<string>('');
  const [selectedDuration, setSelectedDuration] = useState<number>(4);
  const [durationConfirmedForProgId, setDurationConfirmedForProgId] = useState<string>('');

  // Quick Faculty modal/form
  const [showFacForm, setShowFacForm] = useState(false);
  const [facCode, setFacCode] = useState('');
  const [facName, setFacName] = useState('');
  const [facDean, setFacDean] = useState('');

  // Department CRUD state
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [deptFacultyId, setDeptFacultyId] = useState('');
  const [deptHodName, setDeptHodName] = useState('');

  // Course (Programme) CRUD state
  const [showProgForm, setShowProgForm] = useState(false);
  const [editingProg, setEditingProg] = useState<Programme | null>(null);
  const [progCode, setProgCode] = useState('');
  const [progName, setProgName] = useState('');
  const [progLevel, setProgLevel] = useState<Programme['level']>('Degree');
  const [progDuration, setProgDuration] = useState('4');
  const [progMinGrade, setProgMinGrade] = useState('C+');

  // Unit Registration within a specific Y.S slot
  const [activeSlot, setActiveSlot] = useState<{ year: number; sem: number } | null>(null);
  const [editingUnit, setEditingUnit] = useState<Course | null>(null);
  const [unitCode, setUnitCode] = useState('');
  const [unitTitle, setUnitTitle] = useState('');
  const [unitCredits, setUnitCredits] = useState('3');
  const [unitRoom, setUnitRoom] = useState('Lecture Hall A');
  const [unitSchedule, setUnitSchedule] = useState('Mon 08:00 - 11:00');
  const [unitPrereq, setUnitPrereq] = useState('');
  const [saving, setSaving] = useState(false);

  // Sync defaults cleanly
  useEffect(() => {
    if (!selectedDeptId && data.departments.length > 0) {
      setSelectedDeptId(data.departments[0].id);
    }
  }, [data.departments, selectedDeptId]);

  const deptProgrammes = useMemo(
    () => data.programmes.filter((p) => !selectedDeptId || p.departmentId === selectedDeptId),
    [data.programmes, selectedDeptId]
  );

  useEffect(() => {
    if (deptProgrammes.length > 0 && !deptProgrammes.some((p) => p.id === selectedProgId)) {
      setSelectedProgId(deptProgrammes[0].id);
    } else if (deptProgrammes.length === 0) {
      setSelectedProgId('');
    }
  }, [deptProgrammes, selectedProgId]);

  const selectedDept = data.departments.find((d) => d.id === selectedDeptId);
  const selectedProg = data.programmes.find((p) => p.id === selectedProgId);

  useEffect(() => {
    if (selectedProg) {
      setSelectedDuration(selectedProg.durationYears || 4);
      setDurationConfirmedForProgId('');
      setActiveSlot(null);
      setEditingUnit(null);
    }
  }, [selectedProg?.id]);

  const programmeUnits = useMemo(
    () => data.courses.filter((c) => c.programmeId === selectedProgId),
    [data.courses, selectedProgId]
  );

  const semesterSlots = useMemo(() => {
    const slots: { year: number; sem: number; label: string; units: Course[] }[] = [];
    for (let y = 1; y <= selectedDuration; y += 1) {
      for (let s = 1; s <= 2; s += 1) {
        slots.push({
          year: y,
          sem: s,
          label: `${y}.${s}`,
          units: programmeUnits.filter((u) => u.yearLevel === y && u.semesterNumber === s),
        });
      }
    }
    return slots;
  }, [selectedDuration, programmeUnits]);

  const isDurationConfirmed = Boolean(selectedProg && durationConfirmedForProgId === selectedProg.id);

  // Handlers: Faculty
  const handleSaveFaculty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    const id = makeId('fac');
    setSaving(true);
    try {
      await setDoc(doc(db, 'faculties', id), {
        code: clampStr(facCode.toUpperCase(), 24),
        name: clampStr(facName, 160),
        deanName: clampStr(facDean, 120),
        createdAt: new Date().toISOString(),
      });
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'FACULTY_CREATED',
        `faculties/${id}`,
        `Created school/faculty ${facCode.toUpperCase()} — ${facName}`
      );
      showToast(`Created school/faculty ${facName}.`, 'success');
      setDeptFacultyId(id);
      setFacCode('');
      setFacName('');
      setFacDean('');
      setShowFacForm(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `faculties/${id}`);
    } finally {
      setSaving(false);
    }
  };

  // Handlers: Department
  const openEditDept = (dept: Department) => {
    setEditingDept(dept);
    setDeptCode(dept.code);
    setDeptName(dept.name);
    setDeptFacultyId(dept.facultyId);
    setDeptHodName(dept.hodName || '');
    setShowDeptForm(true);
  };

  const resetDeptForm = () => {
    setEditingDept(null);
    setDeptCode('');
    setDeptName('');
    setDeptFacultyId(data.faculties[0]?.id || '');
    setDeptHodName('');
    setShowDeptForm(false);
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    const facultyId = deptFacultyId || data.faculties[0]?.id || '';
    if (!facultyId) {
      showToast('Create a Faculty / School first before creating a department.', 'error');
      setShowFacForm(true);
      return;
    }
    setSaving(true);
    const id = editingDept ? editingDept.id : makeId('dept');
    try {
      if (editingDept) {
        await updateDoc(doc(db, 'departments', id), {
          code: clampStr(deptCode.toUpperCase(), 24),
          name: clampStr(deptName, 160),
          facultyId,
          hodName: clampStr(deptHodName, 120),
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'DEPARTMENT_UPDATED',
          `departments/${id}`,
          `Updated department ${deptCode.toUpperCase()} — ${deptName}`
        );
        showToast(`Updated department ${deptName}.`, 'success');
      } else {
        await setDoc(doc(db, 'departments', id), {
          code: clampStr(deptCode.toUpperCase(), 24),
          name: clampStr(deptName, 160),
          facultyId,
          hodName: clampStr(deptHodName, 120),
          createdAt: new Date().toISOString(),
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'DEPARTMENT_CREATED',
          `departments/${id}`,
          `Created department ${deptCode.toUpperCase()} — ${deptName}`
        );
        showToast(`Created department ${deptName}.`, 'success');
        setSelectedDeptId(id);
      }
      resetDeptForm();
    } catch (err) {
      handleFirestoreError(err, editingDept ? OperationType.UPDATE : OperationType.CREATE, `departments/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDepartment = async (dept: Department) => {
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    const hasProgs = data.programmes.some((p) => p.departmentId === dept.id);
    if (hasProgs) {
      showToast('Remove or reassign courses under this department before deleting it.', 'error');
      return;
    }
    try {
      await deleteDoc(doc(db, 'departments', dept.id));
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'DEPARTMENT_DELETED',
        `departments/${dept.id}`,
        `Deleted department ${dept.code} — ${dept.name}`
      );
      showToast(`Deleted department ${dept.name}.`, 'info');
      if (selectedDeptId === dept.id) setSelectedDeptId('');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `departments/${dept.id}`);
    }
  };

  // Handlers: Course (Programme)
  const openEditProg = (prog: Programme) => {
    setEditingProg(prog);
    setProgCode(prog.code);
    setProgName(prog.name);
    setProgLevel(prog.level);
    setProgDuration(String(prog.durationYears));
    setProgMinGrade(prog.minKcseGrade || 'C+');
    setShowProgForm(true);
  };

  const resetProgForm = () => {
    setEditingProg(null);
    setProgCode('');
    setProgName('');
    setProgLevel('Degree');
    setProgDuration('4');
    setProgMinGrade('C+');
    setShowProgForm(false);
  };

  const handleSaveProgramme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    if (!selectedDeptId) {
      showToast('Select or create a department first.', 'error');
      return;
    }
    const years = Math.min(7, Math.max(1, Number(progDuration) || 4));
    const id = editingProg ? editingProg.id : makeId('prog');
    setSaving(true);
    try {
      if (editingProg) {
        await updateDoc(doc(db, 'programmes', id), {
          code: clampStr(progCode.toUpperCase(), 32),
          name: clampStr(progName, 180),
          level: progLevel,
          departmentId: selectedDeptId,
          durationYears: years,
          minKcseGrade: clampStr(progMinGrade, 12),
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'COURSE_PROGRAMME_UPDATED',
          `programmes/${id}`,
          `Updated course ${progCode.toUpperCase()} (${years} years)`
        );
        showToast(`Updated course ${progCode.toUpperCase()}.`, 'success');
        if (selectedProgId === id) setSelectedDuration(years);
      } else {
        await setDoc(doc(db, 'programmes', id), {
          code: clampStr(progCode.toUpperCase(), 32),
          name: clampStr(progName, 180),
          level: progLevel,
          departmentId: selectedDeptId,
          durationYears: years,
          minKcseGrade: clampStr(progMinGrade, 12),
          createdAt: new Date().toISOString(),
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'COURSE_PROGRAMME_CREATED',
          `programmes/${id}`,
          `Created course ${progCode.toUpperCase()} — ${progName} (${years} years) under ${selectedDept?.name || selectedDeptId}`
        );
        showToast(`Added course ${progCode.toUpperCase()} (${years} years).`, 'success');
        setSelectedProgId(id);
        setSelectedDuration(years);
      }
      resetProgForm();
    } catch (err) {
      handleFirestoreError(err, editingProg ? OperationType.UPDATE : OperationType.CREATE, `programmes/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmCourseDuration = async () => {
    if (!selectedProg || !firebaseUser || !profile) return;
    const years = Math.min(7, Math.max(1, Number(selectedDuration) || 4));
    setSaving(true);
    try {
      if (years !== selectedProg.durationYears) {
        await updateDoc(doc(db, 'programmes', selectedProg.id), {
          durationYears: years,
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'COURSE_DURATION_CONFIRMED',
          `programmes/${selectedProg.id}`,
          `Set duration for ${selectedProg.code} to ${years} years (${years * 2} semesters: 1.1 to ${years}.2).`
        );
      }
      setDurationConfirmedForProgId(selectedProg.id);
      showToast(
        `Duration confirmed: ${years} Years (${years * 2} semester slots from 1.1 to ${years}.2). Select any semester slot below to register units.`,
        'success'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `programmes/${selectedProg.id}`);
    } finally {
      setSaving(false);
    }
  };

  // Handlers: Unit Registration per Year.Semester
  const openAddUnitForSlot = (year: number, sem: number) => {
    setEditingUnit(null);
    setActiveSlot({ year, sem });
    setUnitCode('');
    setUnitTitle('');
    setUnitCredits('3');
    setUnitRoom('Lecture Hall A');
    setUnitSchedule('Mon 08:00 - 11:00');
    setUnitPrereq('');
  };

  const openEditUnit = (unit: Course) => {
    setEditingUnit(unit);
    setActiveSlot({ year: unit.yearLevel, sem: unit.semesterNumber });
    setUnitCode(unit.code);
    setUnitTitle(unit.title);
    setUnitCredits(String(unit.creditUnits));
    setUnitRoom(unit.room || 'Lecture Hall A');
    setUnitSchedule(unit.schedule || 'Mon 08:00 - 11:00');
    setUnitPrereq(unit.prerequisiteCode || '');
  };

  const handleSaveUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !selectedProg || !activeSlot || !isSuperAdmin) return;
    const id = editingUnit ? editingUnit.id : makeId('crs');
    const now = new Date().toISOString();
    setSaving(true);
    try {
      if (editingUnit) {
        await updateDoc(doc(db, 'courses', id), {
          code: clampStr(unitCode.toUpperCase(), 24),
          title: clampStr(unitTitle, 180),
          yearLevel: activeSlot.year,
          semesterNumber: activeSlot.sem,
          creditUnits: Math.min(12, Math.max(1, Number(unitCredits) || 3)),
          prerequisiteCode: clampStr(unitPrereq.toUpperCase(), 24),
          schedule: clampStr(unitSchedule, 160),
          room: clampStr(unitRoom, 64),
          updatedAt: now,
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'UNIT_UPDATED',
          `courses/${id}`,
          `Updated unit ${unitCode.toUpperCase()} (${selectedProg.code} ${activeSlot.year}.${activeSlot.sem})`
        );
        showToast(`Updated unit ${unitCode.toUpperCase()}.`, 'success');
      } else {
        await setDoc(doc(db, 'courses', id), {
          code: clampStr(unitCode.toUpperCase(), 24),
          title: clampStr(unitTitle, 180),
          programmeId: selectedProg.id,
          departmentId: selectedProg.departmentId,
          yearLevel: activeSlot.year,
          semesterNumber: activeSlot.sem,
          creditUnits: Math.min(12, Math.max(1, Number(unitCredits) || 3)),
          prerequisiteCode: clampStr(unitPrereq.toUpperCase(), 24),
          lecturerUid: '',
          lecturerEmployeeId: '',
          lecturerStaffNo: '',
          lecturerName: 'Unassigned',
          schedule: clampStr(unitSchedule, 160),
          room: clampStr(unitRoom, 64),
          createdAt: now,
          updatedAt: now,
        });
        await recordAuditLog(
          { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
          'UNIT_REGISTERED',
          `courses/${id}`,
          `Registered unit ${unitCode.toUpperCase()} — ${unitTitle} in ${selectedProg.code} Year ${activeSlot.year}.${activeSlot.sem}`
        );
        showToast(`Registered ${unitCode.toUpperCase()} in Year ${activeSlot.year}.${activeSlot.sem}.`, 'success');
      }
      setActiveSlot(null);
      setEditingUnit(null);
    } catch (err) {
      handleFirestoreError(err, editingUnit ? OperationType.UPDATE : OperationType.CREATE, `courses/${id}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteUnit = async (unit: Course) => {
    if (!firebaseUser || !profile || !isSuperAdmin) return;
    try {
      await deleteDoc(doc(db, 'courses', unit.id));
      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'UNIT_DELETED',
        `courses/${unit.id}`,
        `Deleted unit ${unit.code} — ${unit.title}`
      );
      showToast(`Removed unit ${unit.code}.`, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `courses/${unit.id}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step 1: Departments Management */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                1. Institutional Departments &amp; Schools ({data.departments.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create and manage departments (e.g. School of Medicine, Institute of Computing &amp; Informatics). Select a department to manage its courses.
              </p>
            </div>
          </div>
          {isSuperAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowFacForm((v) => !v)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500"
              >
                <FolderPlus className="w-3.5 h-3.5 text-amber-500" />
                <span>{showFacForm ? 'Close Faculty Form' : 'New Faculty / School'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (showDeptForm) resetDeptForm();
                  else {
                    setDeptFacultyId(data.faculties[0]?.id || '');
                    setShowDeptForm(true);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showDeptForm ? 'Cancel' : 'Create Department'}</span>
              </button>
            </div>
          )}
        </div>

        {/* Optional Faculty Creation Form */}
        {isSuperAdmin && showFacForm && (
          <form onSubmit={handleSaveFaculty} className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Faculty / School Code</label>
              <input
                type="text"
                required
                value={facCode}
                onChange={(e) => setFacCode(e.target.value)}
                placeholder="e.g. SOM"
                className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Faculty / School Name</label>
              <input
                type="text"
                required
                value={facName}
                onChange={(e) => setFacName(e.target.value)}
                placeholder="e.g. School of Medicine & Health Sciences"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={facDean}
                onChange={(e) => setFacDean(e.target.value)}
                placeholder="Dean (Optional)"
                className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
              >
                Save Faculty
              </button>
            </div>
          </form>
        )}

        {/* Department Create/Edit Form */}
        {isSuperAdmin && showDeptForm && (
          <form onSubmit={handleSaveDepartment} className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Dept Code</label>
              <input
                type="text"
                required
                value={deptCode}
                onChange={(e) => setDeptCode(e.target.value)}
                placeholder="e.g. ICI or MED"
                className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Department / Institute Name</label>
              <input
                type="text"
                required
                value={deptName}
                onChange={(e) => setDeptName(e.target.value)}
                placeholder="e.g. Institute of Computing and Informatics"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Parent Faculty / School</label>
              <select
                value={deptFacultyId || data.faculties[0]?.id || ''}
                onChange={(e) => setDeptFacultyId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                {data.faculties.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} — {f.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={deptHodName}
                onChange={(e) => setDeptHodName(e.target.value)}
                placeholder="HoD Name"
                className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
              >
                {editingDept ? 'Update' : 'Save'}
              </button>
            </div>
          </form>
        )}

        {/* Department Selector Grid */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.departments.map((dept) => {
            const fac = data.faculties.find((f) => f.id === dept.facultyId);
            const progCount = data.programmes.filter((p) => p.departmentId === dept.id).length;
            const unitCount = data.courses.filter((c) => c.departmentId === dept.id).length;
            const active = dept.id === selectedDeptId;
            return (
              <div
                key={dept.id}
                onClick={() => setSelectedDeptId(dept.id)}
                className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                  active
                    ? 'border-amber-500 bg-amber-500/5 dark:bg-amber-500/10'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      {dept.code} · {fac?.code || 'FAC'}
                    </span>
                    <h4 className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{dept.name}</h4>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => openEditDept(dept)}
                        title="Edit department"
                        className="p-1 rounded text-slate-400 hover:text-amber-500"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDepartment(dept)}
                        title="Delete department"
                        className="p-1 rounded text-slate-400 hover:text-red-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
                  {progCount} Courses · {unitCount} Units{dept.hodName ? ` · HoD: ${dept.hodName}` : ''}
                </p>
              </div>
            );
          })}
          {data.departments.length === 0 && (
            <p className="text-xs text-slate-500 col-span-full py-4 text-center">
              No departments created yet. Click &ldquo;Create Department&rdquo; to begin.
            </p>
          )}
        </div>
      </div>

      {/* Step 2: Courses under Selected Department & Course Duration Selector */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-4 h-4 text-amber-500" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                2. Courses in {selectedDept?.name || 'Department'} ({deptProgrammes.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add courses under the selected department, then select &amp; confirm the course duration before registering semester units.
              </p>
            </div>
          </div>
          {isSuperAdmin && selectedDept && (
            <button
              type="button"
              onClick={() => {
                if (showProgForm) resetProgForm();
                else setShowProgForm(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{showProgForm ? 'Cancel' : `Add Course to ${selectedDept.code}`}</span>
            </button>
          )}
        </div>

        {isSuperAdmin && showProgForm && (
          <form onSubmit={handleSaveProgramme} className="p-5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Course Code</label>
              <input
                type="text"
                required
                value={progCode}
                onChange={(e) => setProgCode(e.target.value)}
                placeholder="e.g. MBCHB or BSC-CS"
                className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Course Title</label>
              <input
                type="text"
                required
                value={progName}
                onChange={(e) => setProgName(e.target.value)}
                placeholder="e.g. Bachelor of Medicine & Surgery"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Level</label>
              <select
                value={progLevel}
                onChange={(e) => setProgLevel(e.target.value as Programme['level'])}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="Degree">Degree</option>
                <option value="Diploma">Diploma</option>
                <option value="Masters">Masters</option>
                <option value="PhD">PhD</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Duration (Years)</label>
              <select
                value={progDuration}
                onChange={(e) => setProgDuration(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                {[1, 2, 3, 4, 5, 6, 7].map((yr) => (
                  <option key={yr} value={String(yr)}>
                    {yr} {yr === 1 ? 'Year' : 'Years'}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={progMinGrade}
                onChange={(e) => setProgMinGrade(e.target.value)}
                placeholder="Min KCSE (C+)"
                className="w-24 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              />
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
              >
                {editingProg ? 'Update' : 'Save Course'}
              </button>
            </div>
          </form>
        )}

        <div className="p-5 space-y-4">
          {deptProgrammes.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">
              No courses registered in this department yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {deptProgrammes.map((prog) => {
                const active = prog.id === selectedProgId;
                const count = data.courses.filter((c) => c.programmeId === prog.id).length;
                return (
                  <div
                    key={prog.id}
                    onClick={() => setSelectedProgId(prog.id)}
                    className={`cursor-pointer rounded-xl border p-4 transition-colors ${
                      active
                        ? 'border-amber-500 bg-amber-500/5 dark:bg-amber-500/10'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                          {prog.code} · {prog.level}
                        </span>
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{prog.name}</h4>
                      </div>
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditProg(prog);
                          }}
                          title="Edit course details"
                          className="p-1 rounded text-slate-400 hover:text-amber-500"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 tabular-nums">
                      Duration: {prog.durationYears} {prog.durationYears === 1 ? 'Year' : 'Years'} · {count} Units Registered
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Duration Gate before registering units */}
          {selectedProg && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-4 flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  3. Select Course Duration Before Registering Units — {selectedProg.code} ({selectedProg.name})
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Confirm the study duration so the curriculum grid prompts unit registration for each year &amp; semester (1.1 through {selectedDuration}.2).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={selectedDuration}
                  onChange={(e) => {
                    setSelectedDuration(Number(e.target.value));
                    setDurationConfirmedForProgId('');
                  }}
                  className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  {[1, 2, 3, 4, 5, 6, 7].map((yr) => (
                    <option key={yr} value={yr}>
                      {yr} {yr === 1 ? 'Year' : 'Years'} ({yr * 2} Semesters: 1.1 – {yr}.2)
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving || !isSuperAdmin}
                  onClick={handleConfirmCourseDuration}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
                    isDurationConfirmed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>
                    {isDurationConfirmed
                      ? `Duration Confirmed (${selectedDuration} Yrs)`
                      : `Confirm ${selectedDuration}-Year Curriculum`}
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Step 4: Year.Semester Unit Registration Grid */}
      {selectedProg && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-amber-500" />
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  4. Year &amp; Semester Unit Curriculum ({selectedProg.code}: 1.1 – {selectedDuration}.2)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {isDurationConfirmed
                    ? `Curriculum unlocked for ${selectedDuration} years (${semesterSlots.length} semester blocks). Register units under their exact Year.Semester slot.`
                    : 'Confirm the course duration above to unlock adding new units to specific Year.Semester slots (existing units shown below).'}
                </p>
              </div>
            </div>
            <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              {programmeUnits.length} Total Units
            </span>
          </div>

          {/* Active Slot Unit Form */}
          {isSuperAdmin && isDurationConfirmed && activeSlot && (
            <form
              onSubmit={handleSaveUnit}
              className="p-5 border-b border-slate-200 dark:border-slate-800 bg-amber-500/5 dark:bg-amber-500/10 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  {editingUnit
                    ? `Edit Unit in ${selectedProg.code} · Year ${activeSlot.year}.${activeSlot.sem}`
                    : `Register New Unit in ${selectedProg.code} · Year ${activeSlot.year}.${activeSlot.sem}`}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setActiveSlot(null);
                    setEditingUnit(null);
                  }}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Unit Code</label>
                  <input
                    type="text"
                    required
                    value={unitCode}
                    onChange={(e) => setUnitCode(e.target.value)}
                    placeholder={`e.g. ${selectedProg.code.slice(0, 3)} ${activeSlot.year}${activeSlot.sem}1`}
                    className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="lg:col-span-2">
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Unit Title</label>
                  <input
                    type="text"
                    required
                    value={unitTitle}
                    onChange={(e) => setUnitTitle(e.target.value)}
                    placeholder="e.g. Human Anatomy & Physiology I"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Credit Units</label>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    required
                    value={unitCredits}
                    onChange={(e) => setUnitCredits(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Room / Lab</label>
                  <input
                    type="text"
                    value={unitRoom}
                    onChange={(e) => setUnitRoom(e.target.value)}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={unitPrereq}
                    onChange={(e) => setUnitPrereq(e.target.value)}
                    placeholder="Prereq Code"
                    className="w-24 px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="flex-1 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white whitespace-nowrap"
                  >
                    {editingUnit ? 'Save Changes' : `Add to ${activeSlot.year}.${activeSlot.sem}`}
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* Dynamic Y.S Grid */}
          <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            {semesterSlots.map((slot) => (
              <div
                key={slot.label}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 flex flex-col justify-between"
              >
                <div>
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 text-white dark:bg-slate-800 tabular-nums">
                        {slot.label}
                      </span>
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                        Year {slot.year} · Semester {slot.sem}
                      </span>
                    </div>
                    {isSuperAdmin && (
                      <button
                        type="button"
                        disabled={!isDurationConfirmed}
                        onClick={() => openAddUnitForSlot(slot.year, slot.sem)}
                        title={
                          isDurationConfirmed
                            ? `Register unit in Semester ${slot.label}`
                            : 'Confirm course duration above first'
                        }
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        <Plus className="w-3 h-3" />
                        <span>Add Unit ({slot.label})</span>
                      </button>
                    )}
                  </div>

                  {slot.units.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500 dark:text-slate-400">
                      No units registered for {slot.label} yet.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200 dark:divide-slate-800">
                      {slot.units.map((unit) => (
                        <div key={unit.id} className="px-4 py-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                              <span className="font-mono text-amber-600 dark:text-amber-400 mr-2">{unit.code}</span>
                              {unit.title}
                            </p>
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                              {unit.creditUnits} Credits · {unit.lecturerName || 'Unassigned'} · {unit.room || 'TBA'}
                            </p>
                          </div>
                          {isSuperAdmin && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isDurationConfirmed) setDurationConfirmedForProgId(selectedProg.id);
                                  openEditUnit(unit);
                                }}
                                title="Edit unit"
                                className="p-1.5 rounded text-slate-400 hover:text-amber-500"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteUnit(unit)}
                                title="Delete unit"
                                className="p-1.5 rounded text-slate-400 hover:text-red-500"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="w-3 h-3" />
                    <span>{slot.units.length} Units</span>
                  </span>
                  <span>
                    {slot.units.reduce((sum, u) => sum + (u.creditUnits || 0), 0)} Credit Units
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
