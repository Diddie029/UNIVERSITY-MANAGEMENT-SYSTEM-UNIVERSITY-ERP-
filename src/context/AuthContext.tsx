import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  BOOTSTRAPPED_ADMIN_EMAIL,
  clampStr,
  db,
  googleProvider,
  handleFirestoreError,
  hashVerificationKey,
  OperationType,
  sanitizeId,
  testConnection,
} from '../lib/firebase';
import { PortalBinding, UserProfile, UserRole } from '../types/erp';

interface AuthContextValue {
  firebaseUser: User | null;
  profile: UserProfile | null;
  actualRole: UserRole;
  effectiveRole: UserRole;
  previewRole: UserRole | null;
  setPreviewRole: (role: UserRole | null) => void;
  authReady: boolean;
  dbConnected: boolean | null;
  authError: string | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmailPassword: (
    email: string,
    password: string,
    mode: 'login' | 'signup',
    displayName?: string
  ) => Promise<void>;
  signInWithPortalCode: (
    code: string,
    verificationSecret: string,
    expectedType: 'student' | 'employee'
  ) => Promise<{ role: UserRole; fullName: string; keptAdmin?: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  firebaseUser: null,
  profile: null,
  actualRole: 'applicant',
  effectiveRole: 'applicant',
  previewRole: null,
  setPreviewRole: () => {},
  authReady: false,
  dbConnected: null,
  authError: null,
  signInWithGoogle: async () => {},
  signInWithEmailPassword: async () => {},
  signInWithPortalCode: async () => ({ role: 'student', fullName: '' }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [previewRole, setPreviewRole] = useState<UserRole | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [dbConnected, setDbConnected] = useState<boolean | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    testConnection().then(setDbConnected);
  }, []);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (user) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setFirebaseUser(user);
      setPreviewRole(null);

      if (!user) {
        setProfile(null);
        setAuthReady(true);
        return;
      }

      try {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);

        if (!snap.exists()) {
          const now = new Date().toISOString();
          const email = (user.email || '').toLowerCase();
          let assignedRole: UserRole = 'applicant';
          let inviteId = '';
          let departmentId = '';

          if (email === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase() && user.emailVerified) {
            assignedRole = 'super_admin';
          } else if (email && user.emailVerified) {
            try {
              const inviteSnap = await getDocs(
                query(collection(db, 'role_invites'), where('email', '==', email))
              );
              if (!inviteSnap.empty) {
                const inviteDoc = inviteSnap.docs[0];
                const inviteData = inviteDoc.data();
                assignedRole = inviteData.role as UserRole;
                inviteId = inviteDoc.id;
                departmentId = inviteData.departmentId || '';
              }
            } catch {
              // Fallback to applicant if invite lookup fails
            }
          }

          const newProfile: Record<string, unknown> = {
            uid: user.uid,
            displayName: clampStr(user.displayName || user.email?.split('@')[0] || 'University User', 160),
            role: assignedRole,
            status: 'active',
            createdAt: now,
            updatedAt: now,
          };
          if (inviteId) newProfile.inviteId = inviteId;
          if (departmentId) newProfile.departmentId = departmentId;

          await setDoc(userRef, newProfile);
          await setDoc(doc(db, 'users', user.uid, 'private', 'pii'), {
            uid: user.uid,
            email: clampStr(user.email || 'unknown@pust.ac.ke', 200),
            phone: '',
            nationalId: '',
            updatedAt: now,
          });
        }

        unsubProfile = onSnapshot(
          userRef,
          (docSnap) => {
            if (docSnap.exists()) {
              setProfile({ id: docSnap.id, ...(docSnap.data() as Omit<UserProfile, 'id'>) });
            }
            setAuthReady(true);
          },
          (err) => {
            handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
          }
        );
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Authentication initialization error.');
        setAuthReady(true);
      }
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      const msg =
        code === 'auth/popup-closed-by-user'
          ? 'Google sign-in popup was closed before completing authentication.'
          : err instanceof Error
          ? err.message
          : 'Google sign-in was cancelled or failed.';
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const signInWithEmailPassword = async (
    email: string,
    password: string,
    mode: 'login' | 'signup',
    displayName?: string
  ) => {
    setAuthError(null);
    const cleanEmail = email.trim();
    if (!cleanEmail || password.length < 6) {
      throw new Error('Enter a valid email address and a password of at least 6 characters.');
    }
    try {
      if (mode === 'signup') {
        const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        if (displayName?.trim()) {
          await updateProfile(cred.user, { displayName: clampStr(displayName, 160) });
        }
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        const msg =
          'Email/Password sign-in is not yet enabled in Firebase Authentication Console. Use Google Sign-In or enable Email/Password under Authentication -> Sign-in method.';
        setAuthError(msg);
        throw new Error(msg);
      }
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
        throw new Error('Invalid email or password.');
      }
      if (code === 'auth/email-already-in-use') {
        throw new Error('An account with this email already exists. Switch to Sign In.');
      }
      if (code === 'auth/weak-password') {
        throw new Error('Password is too weak. Use at least 6 characters.');
      }
      if (code === 'auth/invalid-email') {
        throw new Error('Enter a valid email address.');
      }
      const fallback = err instanceof Error ? err.message : 'Email authentication failed.';
      setAuthError(fallback);
      throw new Error(fallback);
    }
  };

  const signInWithPortalCode = async (
    code: string,
    verificationSecret: string,
    expectedType: 'student' | 'employee'
  ): Promise<{ role: UserRole; fullName: string; keptAdmin?: boolean }> => {
    setAuthError(null);
    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode || !verificationSecret.trim()) {
      throw new Error(
        expectedType === 'student'
          ? 'Enter both your Student Registration Number and National ID.'
          : 'Enter both your Staff Number and Staff Passcode.'
      );
    }

    let activeUser = auth.currentUser;
    if (!activeUser) {
      const result = await signInWithPopup(auth, googleProvider);
      activeUser = result.user;
    }

    const bindingId = sanitizeId(normalizedCode);
    const bindingRef = doc(db, 'portal_bindings', bindingId);
    const bindingSnap = await getDoc(bindingRef);

    if (!bindingSnap.exists()) {
      throw new Error(
        `No portal record found for ${normalizedCode}. Ensure Admissions/HR has registered this ID or Super Admin has seeded the institutional database.`
      );
    }

    const binding = { id: bindingSnap.id, ...(bindingSnap.data() as Omit<PortalBinding, 'id'>) };
    if (binding.targetType !== expectedType) {
      throw new Error(
        expectedType === 'student'
          ? `${normalizedCode} is a Staff ID, not a Student Registration Number.`
          : `${normalizedCode} is a Student Registration Number, not a Staff ID.`
      );
    }

    const providedHash = await hashVerificationKey(verificationSecret);
    if (providedHash !== binding.verificationHash) {
      throw new Error(
        expectedType === 'student'
          ? 'National ID does not match the student admission record.'
          : 'Staff passcode does not match HR records.'
      );
    }

    if (binding.boundUid && binding.boundUid !== activeUser.uid) {
      throw new Error(
        `${normalizedCode} is already linked to another Google account. Contact ICT Support or Super Admin.`
      );
    }

    const now = new Date().toISOString();
    if (!binding.boundUid) {
      await updateDoc(bindingRef, { boundUid: activeUser.uid });
    }

    const userRef = doc(db, 'users', activeUser.uid);
    const userSnap = await getDoc(userRef);
    const isAdminAccount =
      activeUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase() && activeUser.emailVerified;

    if (isAdminAccount || (userSnap.exists() && userSnap.data().role === 'super_admin')) {
      setPreviewRole(binding.role);
      return { role: binding.role, fullName: binding.fullName, keptAdmin: true };
    }

    if (!userSnap.exists()) {
      const payload: Record<string, unknown> = {
        uid: activeUser.uid,
        displayName: clampStr(binding.fullName || activeUser.displayName || 'Portal User', 160),
        role: binding.role,
        bindingId,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      if (expectedType === 'student') payload.studentId = binding.targetId;
      if (expectedType === 'employee') payload.employeeId = binding.targetId;
      await setDoc(userRef, payload);
      await setDoc(doc(db, 'users', activeUser.uid, 'private', 'pii'), {
        uid: activeUser.uid,
        email: clampStr(activeUser.email || 'unknown@pust.ac.ke', 200),
        phone: '',
        nationalId: expectedType === 'student' ? clampStr(verificationSecret, 32) : '',
        updatedAt: now,
      });
    } else {
      const updatePayload: Record<string, unknown> = {
        role: binding.role,
        bindingId,
        updatedAt: now,
      };
      if (expectedType === 'student') updatePayload.studentId = binding.targetId;
      if (expectedType === 'employee') updatePayload.employeeId = binding.targetId;
      await updateDoc(userRef, updatePayload);
    }

    if (expectedType === 'student') {
      try {
        const stuRef = doc(db, 'students', binding.targetId);
        const stuSnap = await getDoc(stuRef);
        if (stuSnap.exists() && !stuSnap.data().uid) {
          await updateDoc(stuRef, { uid: activeUser.uid, updatedAt: now });
        }
        const acctRef = doc(db, 'student_accounts', binding.targetId);
        const acctSnap = await getDoc(acctRef);
        if (acctSnap.exists() && !acctSnap.data().studentUid) {
          await updateDoc(acctRef, { studentUid: activeUser.uid, updatedAt: now });
        }
      } catch {
        // Safe if already linked
      }
    } else {
      try {
        const empRef = doc(db, 'employees', binding.targetId);
        const empSnap = await getDoc(empRef);
        if (empSnap.exists() && !empSnap.data().uid) {
          await updateDoc(empRef, { uid: activeUser.uid, updatedAt: now });
        }
      } catch {
        // Safe if already linked
      }
    }

    return { role: binding.role, fullName: binding.fullName };
  };

  const signOut = async () => {
    setPreviewRole(null);
    await firebaseSignOut(auth);
  };

  const actualRole: UserRole =
    profile?.role ??
    (firebaseUser?.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL.toLowerCase() &&
    firebaseUser?.emailVerified
      ? 'super_admin'
      : 'applicant');

  const effectiveRole: UserRole =
    actualRole === 'super_admin' && previewRole ? previewRole : actualRole;

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        actualRole,
        effectiveRole,
        previewRole,
        setPreviewRole,
        authReady,
        dbConnected,
        authError,
        signInWithGoogle,
        signInWithEmailPassword,
        signInWithPortalCode,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
