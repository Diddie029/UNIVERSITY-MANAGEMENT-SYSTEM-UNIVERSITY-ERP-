import React, { useMemo, useState } from 'react';
import { doc, writeBatch } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { CheckCircle2, Download, FileSpreadsheet, Upload, X } from 'lucide-react';
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
import { generateAdmissionNumber } from '../lib/kenyaEngine';
import { exportToCSV } from '../lib/pdfGenerator';

interface BulkStudentImportModalProps {
  open: boolean;
  data: ErpDataset;
  onClose: () => void;
}

interface ParsedStudentRow {
  rowNum: number;
  fullName: string;
  nationalId: string;
  email: string;
  phone: string;
  programmeId: string;
  programmeCode: string;
  programmeName: string;
  departmentId: string;
  yearOfStudy: number;
  semester: number;
  category: 'KUCCPS' | 'Self-Sponsored';
  admissionNo: string;
  error?: string;
}

export function BulkStudentImportModal({ open, data, onClose }: BulkStudentImportModalProps) {
  const { firebaseUser, profile } = useAuth();
  const { showToast } = useToast();

  const [defaultProgId, setDefaultProgId] = useState('');
  const [defaultYear, setDefaultYear] = useState('1');
  const [defaultSemester, setDefaultSemester] = useState('1');
  const [defaultCategory, setDefaultCategory] = useState<'KUCCPS' | 'Self-Sponsored'>('KUCCPS');
  const [requireActivation, setRequireActivation] = useState(true);

  const [fileName, setFileName] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedStudentRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [importedBatch, setImportedBatch] = useState<ParsedStudentRow[] | null>(null);

  const fallbackProg = useMemo(
    () => data.programmes.find((p) => p.id === (defaultProgId || data.programmes[0]?.id)),
    [data.programmes, defaultProgId]
  );

  if (!open) return null;

  const handleDownloadTemplate = () => {
    const sampleProgCode = fallbackProg?.code || data.programmes[0]?.code || 'BSC-CS';
    const sampleDeptCode =
      data.departments.find((d) => d.id === fallbackProg?.departmentId)?.code ||
      data.departments[0]?.code ||
      'CS';

    const templateRows = [
      {
        'Full Name': 'Grace Wambui Njoroge',
        'National ID': '40128831',
        Email: 'grace.njoroge@students.eduvance.ac.ke',
        Phone: '+254712345678',
        'Department Code': sampleDeptCode,
        'Course Code': sampleProgCode,
        'Year of Study': 1,
        Semester: 1,
        Category: 'KUCCPS',
      },
      {
        'Full Name': 'Daniel Kipchoge Ruto',
        'National ID': '39845120',
        Email: 'daniel.ruto@students.eduvance.ac.ke',
        Phone: '+254722109876',
        'Department Code': sampleDeptCode,
        'Course Code': sampleProgCode,
        'Year of Study': 1,
        Semester: 1,
        Category: 'Self-Sponsored',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Students');
    XLSX.writeFile(workbook, 'EDUVANCE_Bulk_Student_Template.xlsx');
    showToast('Downloaded Excel bulk registration template.', 'success');
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportedBatch(null);
    setFileName(file.name);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) {
        showToast('The uploaded workbook has no sheets.', 'error');
        return;
      }
      const sheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      if (rawRows.length === 0) {
        showToast('No student rows found in the spreadsheet.', 'error');
        setParsedRows([]);
        return;
      }

      const existingRegNos = new Set(data.students.map((s) => s.admissionNo.toUpperCase()));
      let seqOffset = data.students.length + 1;

      const normalized: ParsedStudentRow[] = rawRows.map((row, idx) => {
        const pick = (keys: string[]) => {
          for (const k of keys) {
            const matchedKey = Object.keys(row).find(
              (rk) => rk.trim().toLowerCase() === k.toLowerCase()
            );
            if (matchedKey && String(row[matchedKey]).trim() !== '') {
              return String(row[matchedKey]).trim();
            }
          }
          return '';
        };

        const fullName = clampStr(pick(['Full Name', 'FullName', 'Name', 'Student Name']), 160);
        const nationalId = clampStr(
          pick(['National ID', 'NationalId', 'ID Number', 'ID No', 'Birth Cert', 'Passport']),
          32
        );
        const email = clampStr(pick(['Email', 'Email Address', 'Student Email']), 200);
        const phone = clampStr(pick(['Phone', 'Phone Number', 'Mobile', 'Tel']), 32);
        const rawCourse = pick(['Course Code', 'Course', 'Programme Code', 'Programme']);
        const rawDept = pick(['Department Code', 'Department', 'Dept']);
        const rawYear = Number(pick(['Year of Study', 'Year', 'Level'])) || Number(defaultYear) || 1;
        const rawSem = Number(pick(['Semester', 'Sem'])) || Number(defaultSemester) || 1;
        const rawCat = pick(['Category', 'Sponsorship', 'Entry Category']);

        const matchedDept = data.departments.find(
          (d) =>
            d.code.toLowerCase() === rawDept.toLowerCase() ||
            d.name.toLowerCase() === rawDept.toLowerCase()
        );
        const matchedProg =
          data.programmes.find(
            (p) =>
              p.code.toLowerCase() === rawCourse.toLowerCase() ||
              p.name.toLowerCase() === rawCourse.toLowerCase()
          ) ||
          (matchedDept
            ? data.programmes.find((p) => p.departmentId === matchedDept.id)
            : undefined) ||
          fallbackProg;

        let admissionNo = '';
        if (matchedProg) {
          do {
            admissionNo = generateAdmissionNumber(matchedProg.code, seqOffset).toUpperCase();
            seqOffset += 1;
          } while (existingRegNos.has(admissionNo));
          existingRegNos.add(admissionNo);
        }

        const category: 'KUCCPS' | 'Self-Sponsored' =
          rawCat.toLowerCase().includes('self') || rawCat.toLowerCase().includes('ssp')
            ? 'Self-Sponsored'
            : rawCat.toLowerCase().includes('kuccps')
            ? 'KUCCPS'
            : defaultCategory;

        let error: string | undefined;
        if (!fullName || fullName.length < 2) error = 'Missing Full Name';
        else if (!nationalId || nationalId.length < 4) error = 'National ID must be >= 4 chars';
        else if (!matchedProg) error = 'No valid Course matched';

        const maxDur = matchedProg?.durationYears || 6;

        return {
          rowNum: idx + 2,
          fullName,
          nationalId,
          email,
          phone,
          programmeId: matchedProg?.id || '',
          programmeCode: matchedProg?.code || 'GEN',
          programmeName: matchedProg?.name || 'Unassigned',
          departmentId: matchedDept?.id || matchedProg?.departmentId || '',
          yearOfStudy: Math.min(maxDur, Math.max(1, rawYear)),
          semester: Math.min(3, Math.max(1, rawSem)),
          category,
          admissionNo,
          error,
        };
      });

      setParsedRows(normalized);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unable to parse Excel file.', 'error');
    }
  };

  const validRows = parsedRows.filter((r) => !r.error);
  const invalidCount = parsedRows.length - validRows.length;

  const handleConfirmBulkImport = async () => {
    if (!firebaseUser || !profile || validRows.length === 0) return;
    setImporting(true);
    const now = new Date().toISOString();

    try {
      // Process in chunks of 120 students (360 Firestore writes per batch, under 500 limit)
      const CHUNK_SIZE = 120;
      for (let i = 0; i < validRows.length; i += CHUNK_SIZE) {
        const chunk = validRows.slice(i, i + CHUNK_SIZE);
        const hashes = await Promise.all(chunk.map((r) => hashVerificationKey(r.nationalId)));
        const batch = writeBatch(db);

        chunk.forEach((row, idx) => {
          const studentId = makeId('stu');
          const dept = data.departments.find((d) => d.id === row.departmentId);
          const feeStruct = data.feeStructures.find(
            (f) => f.programmeId === row.programmeId && f.category === row.category
          );
          const initialFee = Number(feeStruct?.totalFee ?? 0);

          batch.set(doc(db, 'students', studentId), {
            uid: '',
            admissionNo: row.admissionNo,
            fullName: row.fullName,
            email: row.email,
            phone: row.phone,
            nationalId: row.nationalId,
            programmeId: row.programmeId,
            programmeName: row.programmeName,
            departmentId: row.departmentId,
            facultyId: dept?.facultyId || '',
            yearOfStudy: row.yearOfStudy,
            semester: row.semester,
            category: row.category,
            academicStatus: 'Active',
            clearanceFinance: initialFee <= 0,
            clearanceLibrary: false,
            clearanceDepartment: false,
            clearanceExams: false,
            accountActivated: !requireActivation,
            bulkImported: true,
            createdAt: now,
            updatedAt: now,
          });

          batch.set(doc(db, 'student_accounts', studentId), {
            studentId,
            studentUid: '',
            admissionNo: row.admissionNo,
            studentName: row.fullName,
            totalBilled: initialFee,
            totalPaid: 0,
            scholarshipsTotal: 0,
            balance: initialFee,
            cleared: initialFee <= 0,
            updatedAt: now,
          });

          batch.set(doc(db, 'portal_bindings', sanitizeId(row.admissionNo)), {
            code: row.admissionNo,
            targetType: 'student',
            targetId: studentId,
            role: 'student',
            fullName: row.fullName,
            verificationHash: hashes[idx],
            boundUid: '',
            activated: !requireActivation,
            createdAt: now,
          });
        });

        await batch.commit();
      }

      await recordAuditLog(
        { uid: firebaseUser.uid, name: profile.displayName, role: profile.role },
        'STUDENTS_BULK_IMPORTED',
        'students/bulk',
        `Bulk imported ${validRows.length} student accounts from ${fileName || 'Excel'} with auto-generated registration numbers (${validRows[0]?.admissionNo}..${validRows[validRows.length - 1]?.admissionNo}).`
      );

      showToast(
        `Registered ${validRows.length} students with auto-generated Registration Numbers${requireActivation ? ' (account activation required on first sign-in)' : ''}.`,
        'success'
      );
      setImportedBatch(validRows);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'students/bulk');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-import-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-amber-500" />
            <div>
              <h2 id="bulk-import-title" className="text-base font-bold text-slate-900 dark:text-white">
                Bulk Student Registration (Excel Upload)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Upload .xlsx, .xls, or .csv lists to auto-generate Registration Numbers, create student accounts, and trigger account activation prompts.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close bulk import modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Defaults & Template */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
            <div className="lg:col-span-2">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Default Course (used if Excel omits Course Code)
              </label>
              <select
                value={defaultProgId || data.programmes[0]?.id || ''}
                onChange={(e) => setDefaultProgId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                {data.programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Default Yr</label>
                <input
                  type="number"
                  min={1}
                  max={7}
                  value={defaultYear}
                  onChange={(e) => setDefaultYear(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Sem</label>
                <input
                  type="number"
                  min={1}
                  max={3}
                  value={defaultSemester}
                  onChange={(e) => setDefaultSemester(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Default Category</label>
              <select
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value as 'KUCCPS' | 'Self-Sponsored')}
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
              >
                <option value="KUCCPS">KUCCPS</option>
                <option value="Self-Sponsored">Self-Sponsored</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>{fileName ? `Replace File (${fileName})` : 'Choose Excel File (.xlsx / .xls / .csv)'}</span>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
              <button
                type="button"
                onClick={handleDownloadTemplate}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500"
              >
                <Download className="w-3.5 h-3.5 text-amber-500" />
                <span>Download Template (.xlsx)</span>
              </button>
            </div>
            <label className="inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={requireActivation}
                onChange={(e) => setRequireActivation(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>Require student self-activation on first login</span>
            </label>
          </div>

          {importedBatch ? (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-5 space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="w-5 h-5" />
                <h3 className="text-sm font-bold">
                  Successfully Provisioned {importedBatch.length} Student Accounts
                </h3>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                Registration numbers and portal bindings have been created. Students can sign in using their generated Registration Number and National ID, and will be prompted to activate their newly issued account before entering the portal.
              </p>
              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() =>
                    exportToCSV(
                      'EDUVANCE_Provisioned_Students.csv',
                      ['Registration No', 'Full Name', 'Initial Key (National ID)', 'Course', 'Year', 'Activation Status'],
                      importedBatch.map((r) => [
                        r.admissionNo,
                        r.fullName,
                        r.nationalId,
                        `${r.programmeCode} — ${r.programmeName}`,
                        `Yr ${r.yearOfStudy}.${r.semester}`,
                        requireActivation ? 'Pending Student Activation' : 'Active',
                      ])
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Generated Reg Numbers (.csv)</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  Done
                </button>
              </div>
            </div>
          ) : parsedRows.length > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">
                  Preview: {validRows.length} valid rows · {invalidCount} invalid rows
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  Registration numbers auto-generated sequentially
                </span>
              </div>
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-500 dark:text-slate-400 sticky top-0">
                    <tr>
                      <th className="py-2.5 px-3 font-medium">Row</th>
                      <th className="py-2.5 px-3 font-medium">Generated Reg No</th>
                      <th className="py-2.5 px-3 font-medium">Full Name</th>
                      <th className="py-2.5 px-3 font-medium">National ID</th>
                      <th className="py-2.5 px-3 font-medium">Course &amp; Year</th>
                      <th className="py-2.5 px-3 font-medium">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {parsedRows.map((row) => (
                      <tr key={`${row.rowNum}_${row.admissionNo}`}>
                        <td className="py-2 px-3 font-mono text-slate-500 tabular-nums">{row.rowNum}</td>
                        <td className="py-2 px-3 font-mono font-semibold text-amber-600 dark:text-amber-400">
                          {row.admissionNo || '—'}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                          {row.fullName || '—'}
                        </td>
                        <td className="py-2 px-3 font-mono">{row.nationalId || '—'}</td>
                        <td className="py-2 px-3">
                          {row.programmeCode} · Yr {row.yearOfStudy}.{row.semester} · {row.category}
                        </td>
                        <td className="py-2 px-3">
                          {row.error ? (
                            <span className="font-semibold text-red-600 dark:text-red-400">{row.error}</span>
                          ) : (
                            <span className="font-semibold text-emerald-600 dark:text-emerald-400">Ready</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Select an Excel spreadsheet (.xlsx / .xls / .csv) with columns such as Full Name, National ID, Email, Phone, Department Code, Course Code, Year of Study, and Category.
            </div>
          )}
        </div>

        {!importedBatch && (
          <div className="px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 bg-slate-50 dark:bg-slate-900/50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={importing || validRows.length === 0}
              onClick={handleConfirmBulkImport}
              className="px-5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50"
            >
              {importing
                ? 'Creating Student Accounts...'
                : `Register ${validRows.length} Student${validRows.length === 1 ? '' : 's'} & Issue Accounts`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
