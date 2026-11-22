import React, { useEffect, useState } from 'react';
import { Briefcase, ExternalLink, GraduationCap, KeyRound, Mail, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import firebaseConfig from '../../firebase-applet-config.json';

interface SignInModalProps {
  open: boolean;
  initialTab?: 'google' | 'student' | 'staff' | 'email';
  onClose: () => void;
  onSuccess?: () => void;
}

export function SignInModal({ open, initialTab = 'google', onClose, onSuccess }: SignInModalProps) {
  const { signInWithGoogle, signInWithEmailPassword, signInWithPortalCode } = useAuth();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'google' | 'student' | 'staff' | 'email'>(initialTab);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [emailProviderDisabled, setEmailProviderDisabled] = useState(false);

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
          : `Welcome, ${res.fullName}. Student portal linked.`,
        'success'
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
              PUST University Portal Sign In
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Choose your institutional sign-in method
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

        {/* Method Tabs */}
        <div className="px-6 pt-4">
          <div className="grid grid-cols-4 gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            {[
              { id: 'google', label: 'Google', icon: ShieldCheck },
              { id: 'student', label: 'Student No', icon: GraduationCap },
              { id: 'staff', label: 'Staff No', icon: Briefcase },
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
                    <li>Or sign in immediately using Google, Student No, or Staff No.</li>
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

          {tab === 'google' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                Sign in directly with your verified Google account. Super Administrators, pre-invited staff, and prospective applicants are routed automatically to their authorized workspace.
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

          {tab === 'student' && (
            <form onSubmit={handleStudentLogin} className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Enter your official Registration / Admission Number and National ID to verify your student profile and link your portal session.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Registration / Admission Number
                </label>
                <input
                  type="text"
                  required
                  value={regNo}
                  onChange={(e) => setRegNo(e.target.value)}
                  placeholder="PUST/BSC-CS/2025/0042"
                  className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  National ID / Birth Cert Number
                </label>
                <input
                  type="password"
                  required
                  value={nationalId}
                  onChange={(e) => setNationalId(e.target.value)}
                  placeholder="e.g. 38910422"
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4" />
                <span>{loading ? 'Verifying Student Record...' : 'Verify & Sign In as Student'}</span>
              </button>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Seeded demo student: PUST/BSC-CS/2025/0042 · ID: 38910422
              </p>
            </form>
          )}

          {tab === 'staff' && (
            <form onSubmit={handleStaffLogin} className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Enter your HR Staff Number and assigned Staff Passcode to activate your Lecturer, HoD, Finance, or HR workspace.
              </p>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Staff Number
                </label>
                <input
                  type="text"
                  required
                  value={staffNo}
                  onChange={(e) => setStaffNo(e.target.value)}
                  placeholder="PUST-STF-0104"
                  className="w-full px-3 py-2 text-sm font-mono uppercase rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Staff Verification Passcode
                </label>
                <input
                  type="password"
                  required
                  value={staffCode}
                  onChange={(e) => setStaffCode(e.target.value)}
                  placeholder="e.g. STF0104"
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                <KeyRound className="w-4 h-4" />
                <span>{loading ? 'Verifying Staff Record...' : 'Verify & Sign In as Staff'}</span>
              </button>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Seeded staff: PUST-STF-0104 (Lecturer · STF0104) · PUST-STF-0119 (Finance · STF0119)
              </p>
            </form>
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
                  placeholder="name@pust.ac.ke"
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
