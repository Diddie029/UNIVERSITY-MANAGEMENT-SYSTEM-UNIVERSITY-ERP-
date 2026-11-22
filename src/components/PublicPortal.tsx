import React, { useMemo, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import {
  ArrowRight,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle2,
  Download,
  FileCheck2,
  Megaphone,
  Moon,
  Pin,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from './Toast';
import { SignInModal } from './SignInModal';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { formatKes } from '../lib/kenyaEngine';
import { generateAdmissionLetterPDF } from '../lib/pdfGenerator';
import { ErpDataset } from '../hooks/useErpData';
import { Notice } from '../types/erp';

interface PublicPortalProps {
  data: ErpDataset;
  onEnterWorkspace: () => void;
}

const FALLBACK_PROGRAMMES = [
  { id: 'prog_bsccs', code: 'BSC-CS', name: 'BSc. Computer Science', level: 'Degree', durationYears: 4, minKcseGrade: 'C+' },
  { id: 'prog_bscce', code: 'BENG-CE', name: 'BSc. Civil Engineering', level: 'Degree', durationYears: 5, minKcseGrade: 'B-' },
  { id: 'prog_bcom', code: 'BCOM', name: 'Bachelor of Commerce (Finance)', level: 'Degree', durationYears: 4, minKcseGrade: 'C+' },
  { id: 'prog_dipict', code: 'DIP-ICT', name: 'Diploma in Information Technology', level: 'Diploma', durationYears: 2, minKcseGrade: 'C-' },
];

const FALLBACK_NOTICES: Notice[] = [
  {
    id: 'n1',
    title: 'January 2027 Intake & KUCCPS / Self-Sponsored Admissions Open',
    body: 'Pwani University of Science & Technology invites qualified KCSE candidates (Mean Grade C+ and above for Degree, C- for Diploma) to apply online and track admission letter issuance in real time.',
    category: 'Admission Intake',
    audience: 'All',
    pinned: true,
    eventDate: '2026-12-15',
    ctaLabel: 'Apply for Admission',
    authorName: 'Office of the Academic Registrar',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n2',
    title: 'Vice-Chancellor STEM Merit Scholarship & County Bursary Window',
    body: 'Continuing First Class Honours and financially needy students can submit HELB, NG-CDF, and County Bursary allocation vouchers at the Finance Office for ledger crediting.',
    category: 'Scholarship / Advert',
    audience: 'All',
    pinned: true,
    eventDate: '2026-12-10',
    ctaLabel: 'View Fee Schedule',
    authorName: 'Dean of Students & Financial Aid',
    createdAt: new Date().toISOString(),
  },
  {
    id: 'n3',
    title: '2026/2027 Semester I Fee Payment & Paybill 522522 Guidelines',
    body: 'Remit fees via M-PESA Paybill 522522 (Account: Admission Number) or KCB Bank deposit and submit the confirmation reference in your portal for Finance Officer verification.',
    category: 'Fee & Finance',
    audience: 'Students',
    pinned: false,
    eventDate: '2026-11-30',
    ctaLabel: 'Portal Sign In',
    authorName: 'Office of the Finance Officer',
    createdAt: new Date().toISOString(),
  },
];

export function PublicPortal({ data, onEnterWorkspace }: PublicPortalProps) {
  const { firebaseUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { showToast } = useToast();

  const [heroImgError, setHeroImgError] = useState(false);
  const [crestImgError, setCrestImgError] = useState(false);

  const [signInOpen, setSignInOpen] = useState(false);
  const [signInTab, setSignInTab] = useState<'google' | 'student' | 'staff' | 'email'>('google');
  const [noticeCategoryFilter, setNoticeCategoryFilter] = useState<string>('All');

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [kcseIndex, setKcseIndex] = useState('');
  const [kcseMeanGrade, setKcseMeanGrade] = useState('B');
  const [programmeId, setProgrammeId] = useState('');
  const [entryCategory, setEntryCategory] = useState<'KUCCPS' | 'Self-Sponsored'>('Self-Sponsored');
  const [intake, setIntake] = useState('January 2027');
  const [appFeePaybillRef, setAppFeePaybillRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const programmesList = data.programmes.length > 0 ? data.programmes : FALLBACK_PROGRAMMES;
  const selectedProgId = programmeId || programmesList[0]?.id || 'prog_bsccs';

  const openSignIn = (tab: 'google' | 'student' | 'staff' | 'email' = 'google') => {
    setSignInTab(tab);
    setSignInOpen(true);
  };

  const noticesList = useMemo(() => {
    const raw = data.notices.length > 0 ? data.notices : FALLBACK_NOTICES;
    return [...raw].sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [data.notices]);

  const filteredNotices = useMemo(() => {
    if (noticeCategoryFilter === 'All') return noticesList;
    return noticesList.filter((n) => (n.category || 'Academic Circular') === noticeCategoryFilter);
  }, [noticesList, noticeCategoryFilter]);

  const handleNoticeCta = (ctaLabel?: string) => {
    if (!ctaLabel) return;
    if (ctaLabel === 'Portal Sign In') {
      if (firebaseUser) onEnterWorkspace();
      else openSignIn('google');
      return;
    }
    if (ctaLabel === 'View Fee Schedule') {
      document.getElementById('fees')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    document.getElementById('admissions')?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      openSignIn('google');
      showToast('Sign in with Google or Email first to track your live application status.', 'info');
      return;
    }

    if (data.programmes.length === 0) {
      showToast('Admissions catalogue is not yet initialized by Super Admin. Sign in as Super Admin to initialize.', 'error');
      return;
    }

    const chosenProg = data.programmes.find((p) => p.id === selectedProgId);
    if (!chosenProg) {
      showToast('Please select a valid academic programme.', 'error');
      return;
    }

    setSubmitting(true);
    const appId = makeId('app');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'applications', appId), {
        applicantUid: firebaseUser.uid,
        fullName: clampStr(fullName, 160),
        email: clampStr(firebaseUser.email || '', 200),
        phone: clampStr(phone, 32),
        nationalId: clampStr(nationalId, 32),
        kcseIndex: clampStr(kcseIndex, 32),
        kcseMeanGrade: clampStr(kcseMeanGrade, 8),
        programmeId: chosenProg.id,
        programmeName: clampStr(chosenProg.name, 180),
        entryCategory,
        intake: clampStr(intake, 64),
        appFeePaybillRef: clampStr(appFeePaybillRef.toUpperCase(), 32),
        status: 'submitted',
        generatedAdmissionNo: '',
        reviewNotes: '',
        reviewedBy: '',
        createdAt: now,
        updatedAt: now,
      });
      showToast('Application submitted in real time. Watch the live status tracker right beside the form.', 'success');
      setFullName('');
      setPhone('');
      setNationalId('');
      setKcseIndex('');
      setAppFeePaybillRef('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `applications/${appId}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-[#0B1120]/95 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-50 whitespace-nowrap shrink-0 font-display"
          >
            Pwani University ERP
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
            <a href="#notices" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Notice Board
            </a>
            <a href="#programmes" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Programmes
            </a>
            <a href="#fees" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Fee Structure
            </a>
            <a href="#admissions" className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0">
              Admissions
            </a>
          </nav>

          <div className="flex items-center shrink-0">
            {firebaseUser ? (
              <button
                type="button"
                onClick={onEnterWorkspace}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap shrink-0"
              >
                Open ERP Workspace
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openSignIn('google')}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap shrink-0"
              >
                Portal Sign In
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Utility Toolbar below Top Bar */}
      <div id="top" className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-100/70 dark:bg-[#111827]">
        <div className="max-w-7xl mx-auto px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            <span>Pwani University of Science &amp; Technology</span>
            <span aria-hidden="true">·</span>
            <span>Mombasa Main Campus</span>
            <span aria-hidden="true">·</span>
            <span>M-PESA Paybill 522522</span>
          </div>
          <div className="flex items-center gap-2">
            {!firebaseUser && (
              <>
                <button
                  type="button"
                  onClick={() => openSignIn('student')}
                  className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-amber-500 transition-colors whitespace-nowrap"
                >
                  Student Reg No Login
                </button>
                <button
                  type="button"
                  onClick={() => openSignIn('staff')}
                  className="px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-amber-500 transition-colors whitespace-nowrap"
                >
                  Staff No Login
                </button>
              </>
            )}
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-amber-500 transition-colors whitespace-nowrap"
            >
              {theme === 'dark' ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-700" />}
              <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Hero Split */}
      <section className="max-w-7xl mx-auto px-6 py-12 lg:py-16">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
          <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
            <div className="flex items-center gap-4">
              {!crestImgError ? (
                <img
                  src="/src/assets/images/pust_university_crest_1795344818405.jpg"
                  alt="Pwani University of Science & Technology Crest"
                  referrerPolicy="no-referrer"
                  onError={() => setCrestImgError(true)}
                  className="w-14 h-14 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center shrink-0">
                  <Building2 className="w-6 h-6 text-amber-400" />
                </div>
              )}
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                <p className="font-semibold text-slate-800 dark:text-slate-200">Chartered Kenyan University Ecosystem</p>
                <p>Academic Year 2026/2027 · January &amp; September Intakes</p>
              </div>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold tracking-tight text-slate-900 dark:text-white leading-[1.15] text-balance">
              Unified Academic, Finance &amp; HR Management Portal
            </h1>

            <p className="text-base text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
              Integrated enterprise platform connecting prospective applicants, enrolled students, lecturers, finance reconciliation officers, and human resource payroll teams under role-verified governance.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <a
                href="#admissions"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors whitespace-nowrap"
              >
                <span>Apply for Admission</span>
                <ArrowRight className="w-4 h-4" />
              </a>
              <button
                type="button"
                onClick={firebaseUser ? onEnterWorkspace : () => openSignIn('student')}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <ShieldCheck className="w-4 h-4 text-amber-500" />
                <span>{firebaseUser ? 'Enter Staff / Student Portal' : 'Student & Staff Sign In'}</span>
              </button>
            </div>
          </div>

          <div className="lg:col-span-6">
            <div className="relative h-72 lg:h-full min-h-[320px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-900">
              {!heroImgError ? (
                <img
                  src="/src/assets/images/pust_campus_hero_1795344817409.jpg"
                  alt="Pwani University of Science & Technology Engineering Complex"
                  referrerPolicy="no-referrer"
                  onError={() => setHeroImgError(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-amber-950/40 flex items-center justify-center p-8 text-center">
                  <div className="space-y-2">
                    <Building2 className="w-10 h-10 text-amber-400 mx-auto" />
                    <p className="text-sm font-medium text-slate-200">Pwani University of Science &amp; Technology</p>
                  </div>
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent flex flex-col justify-end p-6">
                <p className="text-xs text-amber-300 font-medium">Mombasa Main Engineering &amp; Senate Complex</p>
                <p className="text-sm text-white/90 mt-1">
                  Real-time semester registration, verified Paybill fee clearance, and Senate-approved transcripts.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width 4-Column Operational Summary Strip Below Hero */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
          <div className="p-5 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Accredited Programmes</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {data.programmes.length || FALLBACK_PROGRAMMES.length}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">Degree &amp; Diploma Cohorts</p>
          </div>
          <div className="p-5 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Fee Payment Verification</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">522522</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">Paybill &amp; Bank Reconciliation</p>
          </div>
          <div className="p-5 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Kenyan Statutory Payroll</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">PAYE · SHIF</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">NSSF &amp; Housing Levy Engine</p>
          </div>
          <div className="p-5 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">Exam Grading Standard</p>
            <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">30 / 70</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">CAT &amp; Senate Exam Workflow</p>
          </div>
        </div>
      </section>

      {/* Campus Notice Board & Admissions Advertisements */}
      <section id="notices" className="max-w-7xl mx-auto px-6 py-10 border-t border-slate-200 dark:border-slate-800 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Megaphone className="w-5 h-5 text-amber-500" />
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                University Notice Board &amp; Campus Showcase
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Live official announcements, admission intake adverts, scholarships, and campus events
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {['All', 'Admission Intake', 'Scholarship / Advert', 'Campus Event', 'Fee & Finance', 'Academic Circular'].map(
              (cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setNoticeCategoryFilter(cat)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    noticeCategoryFilter === cat
                      ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {cat}
                </button>
              )
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredNotices.map((notice) => (
            <article
              key={notice.id}
              className={`rounded-xl border p-5 flex flex-col justify-between gap-4 transition-colors ${
                notice.pinned
                  ? 'border-amber-500/40 bg-amber-500/[0.04] dark:bg-amber-500/[0.06]'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]'
              }`}
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-medium text-amber-600 dark:text-amber-400">
                    {notice.category || 'Academic Circular'} · {notice.audience}
                  </span>
                  {notice.pinned && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      <Pin className="w-3 h-3" />
                      <span>Featured</span>
                    </span>
                  )}
                </div>

                <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-snug">
                  {notice.title}
                </h3>

                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{notice.body}</p>
              </div>

              <div className="pt-3 border-t border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                  <p>{notice.authorName}</p>
                  {notice.eventDate && (
                    <p className="inline-flex items-center gap-1 font-mono">
                      <Calendar className="w-3 h-3" />
                      <span>{notice.eventDate}</span>
                    </p>
                  )}
                </div>

                {notice.ctaLabel && (
                  <button
                    type="button"
                    onClick={() => handleNoticeCta(notice.ctaLabel)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap"
                  >
                    <span>{notice.ctaLabel}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* Programmes & Fee Schedules */}
      <section id="programmes" className="max-w-7xl mx-auto px-6 py-10 border-t border-slate-200 dark:border-slate-800">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white">
              <BookOpen className="w-5 h-5 text-amber-500" />
              <h2 className="text-xl font-bold">Academic Programmes</h2>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-3 px-4 font-medium">Code</th>
                    <th className="py-3 px-4 font-medium">Programme Title</th>
                    <th className="py-3 px-4 font-medium text-right">Duration</th>
                    <th className="py-3 px-4 font-medium text-right">Min KCSE</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {programmesList.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-amber-600 dark:text-amber-400">{p.code}</td>
                      <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-100">
                        {p.name}
                        <span className="block text-xs text-slate-500 dark:text-slate-400 font-normal">{p.level}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">{p.durationYears} yrs</td>
                      <td className="py-3 px-4 text-right font-mono text-slate-700 dark:text-slate-200">{p.minKcseGrade || 'C+'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div id="fees" className="lg:col-span-6 space-y-4">
            <div className="flex items-center gap-2 text-slate-900 dark:text-white">
              <FileCheck2 className="w-5 h-5 text-amber-500" />
              <h2 className="text-xl font-bold">Semester Fee Schedules</h2>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-3 px-4 font-medium">Programme</th>
                    <th className="py-3 px-4 font-medium">Category</th>
                    <th className="py-3 px-4 font-medium text-right">Tuition</th>
                    <th className="py-3 px-4 font-medium text-right">Total / Sem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {(data.feeStructures.length > 0
                    ? data.feeStructures
                    : [
                        { id: '1', programmeName: 'BSc. Computer Science', category: 'KUCCPS', tuitionFee: 22000, totalFee: 28500 },
                        { id: '2', programmeName: 'BSc. Computer Science', category: 'Self-Sponsored', tuitionFee: 60000, totalFee: 68000 },
                        { id: '3', programmeName: 'Bachelor of Commerce (Finance)', category: 'KUCCPS', tuitionFee: 19500, totalFee: 25500 },
                        { id: '4', programmeName: 'BSc. Civil Engineering', category: 'Self-Sponsored', tuitionFee: 72000, totalFee: 81000 },
                      ]
                  ).map((f) => (
                    <tr key={f.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-medium text-slate-800 dark:text-slate-100">{f.programmeName}</td>
                      <td className="py-3 px-4 text-xs text-slate-600 dark:text-slate-300">{f.category}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatKes(f.tuitionFee)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-white">
                        {formatKes(f.totalFee)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* Online Admissions Form + Real-Time Application Tracker */}
      <section id="admissions" className="max-w-7xl mx-auto px-6 py-10 border-t border-slate-200 dark:border-slate-800">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7 border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-6 space-y-5">
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Online Student Application</h2>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                Submit your KCSE qualifications and Paybill reference (KES 1,500 via Paybill 522522) directly to the Admissions Senate queue.
              </p>
            </div>

            <form onSubmit={handleSubmitApplication} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Full Official Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Maryanne Muthoni Kariuki"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+254712345678"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">National ID / Birth Cert No</label>
                <input
                  type="text"
                  required
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="40192833"
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">KCSE Index &amp; Mean Grade</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={kcseIndex}
                    onChange={(e) => setKcseIndex(e.target.value)}
                    placeholder="20401002/019"
                    className="flex-1 px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <select
                    value={kcseMeanGrade}
                    onChange={(e) => setKcseMeanGrade(e.target.value)}
                    className="w-24 px-2 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    {['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-'].map((g) => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Preferred Programme</label>
                <select
                  value={selectedProgId}
                  onChange={(e) => setProgrammeId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                >
                  {programmesList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">Entry Category &amp; Intake</label>
                <div className="flex gap-2">
                  <select
                    value={entryCategory}
                    onChange={(e) => setEntryCategory(e.target.value as 'KUCCPS' | 'Self-Sponsored')}
                    className="flex-1 px-2 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  >
                    <option value="Self-Sponsored">Self-Sponsored</option>
                    <option value="KUCCPS">KUCCPS</option>
                  </select>
                  <input
                    type="text"
                    value={intake}
                    onChange={(e) => setIntake(e.target.value)}
                    className="w-32 px-2 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Application Fee M-PESA Paybill / Bank Ref Code
                </label>
                <input
                  type="text"
                  required
                  value={appFeePaybillRef}
                  onChange={(e) => setAppFeePaybillRef(e.target.value)}
                  placeholder="e.g. UCK9P2X4L1"
                  className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-4 pt-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {firebaseUser
                    ? `Verified Account: ${firebaseUser.email}`
                    : 'Sign in with Google or Email to submit and track live status'}
                </span>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-60 whitespace-nowrap"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{firebaseUser ? (submitting ? 'Submitting...' : 'Submit Application') : 'Sign In & Apply'}</span>
                </button>
              </div>
            </form>
          </div>

          <div className="lg:col-span-5 space-y-4">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">Real-Time Application Tracker</h2>
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y divide-slate-200 dark:divide-slate-800">
              {!firebaseUser ? (
                <div className="p-6 space-y-4">
                  <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    Sign in to view your submitted admission applications in real time, monitor Admissions Senate review, and download your Admission Letter as soon as you are admitted.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openSignIn('google')}
                      className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                    >
                      Applicant Sign In
                    </button>
                    <button
                      type="button"
                      onClick={() => openSignIn('student')}
                      className="px-4 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500"
                    >
                      Admitted Student Login
                    </button>
                  </div>
                </div>
              ) : data.applications.length === 0 ? (
                <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                  Signed in as <span className="font-semibold text-slate-800 dark:text-slate-200">{firebaseUser.email}</span>. No admission applications submitted yet—use the form beside this tracker to submit one.
                </div>
              ) : (
                data.applications.slice(0, 5).map((app) => (
                  <div key={app.id} className="p-5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                        {app.entryCategory} · {app.intake || '2026/2027'}
                      </span>
                      <span
                        className={`text-xs font-semibold uppercase ${
                          app.status === 'admitted'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : app.status === 'rejected'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {app.status.replace('_', ' ')}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {app.programmeName || app.programmeId}
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Applicant: {app.fullName} · KCSE {app.kcseMeanGrade}
                    </p>
                    {app.generatedAdmissionNo && (
                      <p className="text-xs font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                        Admission No: {app.generatedAdmissionNo}
                      </p>
                    )}
                    {app.status === 'admitted' && (
                      <button
                        type="button"
                        onClick={() => generateAdmissionLetterPDF(app)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Admission Letter</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-8 mt-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <p>Pwani University of Science &amp; Technology (PUST) · Centralized University ERP</p>
          <p>Kenya Data Protection Act Compliant · Role-Enforced Portal</p>
        </div>
      </footer>

      <SignInModal
        open={signInOpen}
        initialTab={signInTab}
        onClose={() => setSignInOpen(false)}
        onSuccess={onEnterWorkspace}
      />
    </div>
  );
}
