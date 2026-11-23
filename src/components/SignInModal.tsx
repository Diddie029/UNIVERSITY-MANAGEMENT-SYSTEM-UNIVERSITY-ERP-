import React, { useEffect, useState } from 'react';
import {
  Briefcase,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import firebaseConfig from '../../firebase-applet-config.json';

interface SignInModalProps {
  open: boolean;
  initialTab?: 'google' | 'student' | 'staff' | 'email';
  onClose: () => void;
  onSuccess?: () => void;
}

export function SignInModal({ open, initialTab = 'student', onClose, onSuccess }: SignInModalProps) {
  const { firebaseUser, signInWithGoogle, signInWithEmailPassword, signInWithPortalCode } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'google' | 'student' | 'staff' | 'email'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailProviderDisabled, setEmailProviderDisabled] = useState(false);
  const [showStudentSecret, setShowStudentSecret] = useState(false);
  const [showStaffSecret, setShowStaffSecret] = useState(false);

  // Student Reg No login state
  const [regNo, setRegNo] = useState('');
  const [nationalId, setNationalId] = useState('');

  // Staff No login state
  const [staffNo, setStaffNo] = useState('');
  const [staffCode, setStaffCode] = useState('');

  // Email/Password state
  const [emailMode, setEmailMode] = useState<'login' | 'signup'>('login');
  const [emailName, setEmailName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setTab(initialTab);
    setErrorMsg(null);
    setEmailProviderDisabled(false);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      showToast('Signed in with Google successfully.', 'success');
      onClose();
      onSuccess?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleStudentLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await signInWithPortalCode(regNo, nationalId, 'student');
      showToast(
        res.keptAdmin
          ? `Verified student record (${res.fullName}). Super Admin session switched to Student Preview.`
          : res.needsActivation
          ? `Welcome, ${res.fullName}. Your new account requires activation before entering the portal.`
          : `Welcome, ${res.fullName}. Student portal linked.`,
        res.needsActivation ? 'info' : 'success'
      );
      onClose();
      onSuccess?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Student verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setLoading(true);
    try {
      const res = await signInWithPortalCode(staffNo, staffCode, 'employee');
      showToast(
        res.keptAdmin
          ? `Verified staff record (${res.fullName}). Super Admin session switched to ${res.role} Preview.`
          : `Welcome, ${res.fullName}. Staff portal authenticated.`,
        'success'
      );
      onClose();
      onSuccess?.();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Staff verification failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setEmailProviderDisabled(false);
    setLoading(true);
    try {
      await signInWithEmailPassword(email, password, emailMode, emailName);
      showToast(
        emailMode === 'signup' ? 'Applicant account created and signed in.' : 'Signed in successfully.',
        'success'
      );
      onClose();
      onSuccess?.();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      setErrorMsg(msg);
      if (msg.includes('not yet enabled') || msg.includes('operation-not-allowed')) {
        setEmailProviderDisabled(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-xs p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 id="signin-modal-title" className="text-base font-bold text-slate-900 dark:text-white">
              EDUVANCE ERP Portal Sign In
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sign in with your Student Registration Number, Staff ID, Google, or Email
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Method Tabs (Student & Staff Registration No prioritized first) */}
        <div className="px-6 pt-4">
          <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {[
              { id: 'student', label: 'Student No', icon: GraduationCap },
              { id: 'staff', label: 'Staff ID', icon: Briefcase },
              { id: 'google', label: 'Google', icon: ShieldCheck },
              { id: 'email', label: 'Email', icon: Mail },
            ].map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setTab(item.id as typeof tab);
                    setErrorMsg(null);
                    setEmailProviderDisabled(false);
                  }}
                  className={`flex items-center justify-center gap-1.5 py-2 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
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

        <div className="p-6 space-y-4">
          {errorMsg && (
            <div className="p-3.5 rounded-lg border border-red-500/40 bg-red-500/10 text-xs text-red-700 dark:text-red-300 leading-relaxed space-y-2.5">
              <p>{errorMsg}</p>
              {emailProviderDisabled && (
                <div className="pt-2 border-t border-red-500/20 space-y-2">
                  <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-200">
                    <li>Open Firebase Console Authentication Sign-in providers.</li>
                    <li>Select <strong className="font-semibold">Email/Password</strong>, toggle <strong className="font-semibold">Enable</strong>, and save.</li>
                    <li>Or sign in immediately using Student No, Staff ID, or Google.</li>
                  </ol>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={handleGoogleLogin}
                      className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold whitespace-nowrap"
                    >
                      Continue with Google Now
                    </button>
                    <a
                      href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 hover:border-amber-500 font-medium whitespace-nowrap"
                    >
                      <span>Open Firebase Auth Console</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'student' && (
            <form onSubmit={handleStudentLogin} className="space-y-4">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  {firebaseUser
                    ? `Session active (${firebaseUser.email || firebaseUser.uid.slice(0, 8)}). Enter your Registration Number & National ID to open your student portal.`
                    : 'Enter your official Student Registration Number and National ID. Your Google account is verified once to bind your student workspace.'}
                </span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Registration / Admission Number
                </label>
                <input
                  type="text"
                  required
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="EDU/BSC-CS/2025/0042 or PUST/BSC-CS/2025/0042"
                  className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  National ID / Birth Cert Number
                </label>
                <div className="relative">
                  <input
                    type={showStudentSecret ? 'text' : 'password'}
                    required
                    value={nationalId}
                    onChange={(e) => setNationalId(e.target.value)}
                    placeholder="e.g. 38910422"
                    className="w-full pl-3 pr-10 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowStudentSecret((v) => !v)}
                    aria-label={showStudentSecret ? 'Hide National ID' : 'Show National ID'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showStudentSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4" />
                <span>{loading ? 'Verifying Student Record...' : 'Sign In with Registration Number'}</span>
              </button>
              <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">Demo: EDU/BSC-CS/2025/0042 · ID 38910422</span>
                <button
                  type="button"
                  onClick={() => {
                    setRegNo('EDU/BSC-CS/2025/0042');
                    setNationalId('38910422');
                  }}
                  className="font-semibold text-amber-600 dark:text-amber-400 hover:underline whitespace-nowrap"
                >
                  Fill Demo Student
                </button>
              </div>
            </form>
          )}

          {tab === 'staff' && (
            <form onSubmit={handleStaffLogin} className="space-y-4">
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 text-xs text-slate-600 dark:text-slate-300 leading-relaxed flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <span>
                  {firebaseUser
                    ? `Session active (${firebaseUser.email || firebaseUser.uid.slice(0, 8)}). Enter your Staff ID & Passcode to enter your department workspace.`
                    : 'Enter your HR Staff Registration Number and assigned Passcode to access Lecturer, HoD, Finance, Admissions, or HR tools.'}
                </span>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Staff Registration Number
                </label>
                <input
                  type="text"
                  required
                  value={staffNo}
                  onChange={(e) => setStaffNo(e.target.value)}
                  placeholder="EDU-STF-0104 or PUST-STF-0104"
                  className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Staff Verification Passcode
                </label>
                <div className="relative">
                  <input
                    type={showStaffSecret ? 'text' : 'password'}
                    required
                    value={staffCode}
                    onChange={(e) => setStaffCode(e.target.value)}
                    placeholder="e.g. STF0104"
                    className="w-full pl-3 pr-10 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                  <button
                    type="button"
                    onClick={() => setShowStaffSecret((v) => !v)}
                    aria-label={showStaffSecret ? 'Hide Staff Passcode' : 'Show Staff Passcode'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  >
                    {showStaffSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4" />
                <span>{loading ? 'Verifying Staff Record...' : 'Sign In with Staff Number'}</span>
              </button>
              <div className="pt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span className="font-mono">Quick fill:</span>
                {[
                  { label: 'Lecturer (0104)', code: 'EDU-STF-0104', secret: 'STF0104' },
                  { label: 'Finance (0119)', code: 'EDU-STF-0119', secret: 'STF0119' },
                  { label: 'HoD (0205)', code: 'EDU-STF-0205', secret: 'STF0205' },
                ].map((preset) => (
                  <button
                    key={preset.code}
                    type="button"
                    onClick={() => {
                      setStaffNo(preset.code);
                      setStaffCode(preset.secret);
                    }}
                    className="px-2 py-0.5 rounded border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-amber-600 dark:text-amber-400 font-medium whitespace-nowrap"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </form>
          )}

          {tab === 'google' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Sign in directly with your verified Google account. Super Administrators, pre-invited staff, and prospective applicants are routed automatically to their authorized EDUVANCE ERP workspace.
              </p>
              <button
                type="button"
                disabled={loading}
                onClick={handleGoogleLogin}
                className="w-full py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {loading ? 'Authenticating...' : 'Continue with Google'}
              </button>
            </div>
          )}

          {tab === 'email' && (
            <form onSubmit={handleEmailAuth} className="space-y-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500 dark:text-slate-400">
                  {emailMode === 'login' ? 'Sign in with registered email' : 'Create prospective applicant account'}
                </span>
                <button
                  type="button"
                  onClick={() => setEmailMode((m) => (m === 'login' ? 'signup' : 'login'))}
                  className="font-semibold text-amber-600 dark:text-amber-400 hover:underline"
                >
                  {emailMode === 'login' ? 'Create Account' : 'Back to Sign In'}
                </button>
              </div>
              {emailMode === 'signup' && (
                <div>
                  <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={emailName}
                    onChange={(e) => setEmailName(e.target.value)}
                    placeholder="e.g. Maryanne Muthoni"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@eduvance.ac.ke"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 6 characters"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {loading
                  ? 'Please wait...'
                  : emailMode === 'signup'
                  ? 'Register & Sign In'
                  : 'Sign In with Email'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
