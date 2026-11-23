import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider, useToast } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PublicPortal } from './components/PublicPortal';
import { ErpLayout } from './components/ErpLayout';
import { StudentActivationGate } from './components/StudentActivationGate';
import { useErpData } from './hooks/useErpData';
import { filterNotificationsForStudent, isNotificationRead } from './lib/notifications';
import { DashboardModule } from './modules/DashboardModule';
import { AdmissionsModule } from './modules/AdmissionsModule';
import { StudentsAcademicsModule } from './modules/StudentsAcademicsModule';
import { FinanceModule } from './modules/FinanceModule';
import { HrPayrollModule } from './modules/HrPayrollModule';
import { GovernanceModule } from './modules/GovernanceModule';
import { ServicesModule } from './modules/ServicesModule';
import { ResourcesModule } from './modules/ResourcesModule';
import { ErpSection, ROLE_NAV_SECTIONS } from './types/erp';

function ErpRouter() {
  const { firebaseUser, profile, authReady, actualRole, effectiveRole } = useAuth();
  const { showToast } = useToast();
  const data = useErpData();

  const [viewMode, setViewMode] = useState<'public' | 'erp'>('public');
  const [activeSection, setActiveSection] = useState<ErpSection>('dashboard');

  const isSuperAdmin = actualRole === 'super_admin';

  const myStudent = useMemo(() => {
    if (effectiveRole !== 'student') return undefined;
    return (
      data.students.find((s) => s.id === profile?.studentId || s.uid === firebaseUser?.uid) ??
      (isSuperAdmin ? data.students[0] : undefined)
    );
  }, [effectiveRole, data.students, profile?.studentId, firebaseUser?.uid, isSuperAdmin]);

  const myRegisteredCourseIds = useMemo(() => {
    if (!myStudent) return new Set<string>();
    return new Set(
      data.registrations
        .filter((r) => r.studentId === myStudent.id && r.status === 'registered')
        .map((r) => r.courseId)
    );
  }, [data.registrations, myStudent]);

  const readIdsSet = useMemo(() => new Set(data.notificationReadIds), [data.notificationReadIds]);

  const studentAlerts = useMemo(() => {
    if (effectiveRole !== 'student') return [];
    return filterNotificationsForStudent(
      data.studentNotifications,
      myStudent,
      firebaseUser?.uid,
      myRegisteredCourseIds
    );
  }, [effectiveRole, data.studentNotifications, myStudent, firebaseUser?.uid, myRegisteredCourseIds]);

  const unreadResourcesAlerts = useMemo(
    () => studentAlerts.filter((n) => !isNotificationRead(n, readIdsSet)).length,
    [studentAlerts, readIdsSet]
  );

  // Real-time push toast alerts whenever a new grade, assignment, or assessment arrives via Firestore onSnapshot
  const alertsHydratedRef = useRef(false);
  const seenAlertIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!firebaseUser || effectiveRole !== 'student') {
      alertsHydratedRef.current = false;
      seenAlertIdsRef.current.clear();
      return;
    }
    if (data.loading) return;

    if (!alertsHydratedRef.current) {
      studentAlerts.forEach((n) => seenAlertIdsRef.current.add(n.id));
      alertsHydratedRef.current = true;
      return;
    }

    for (const n of studentAlerts) {
      if (!seenAlertIdsRef.current.has(n.id)) {
        seenAlertIdsRef.current.add(n.id);
        if (!isNotificationRead(n, readIdsSet)) {
          showToast(`${n.courseCode}: ${n.title}`, n.category === 'grade' ? 'success' : 'info');
        }
      }
    }
  }, [firebaseUser, effectiveRole, data.loading, studentAlerts, readIdsSet, showToast]);

  // Auto-enter ERP workspace when signed in
  useEffect(() => {
    if (authReady && firebaseUser) {
      setViewMode('erp');
    } else if (authReady && !firebaseUser) {
      setViewMode('public');
    }
  }, [authReady, firebaseUser]);

  // Keep activeSection within role's authorized sections
  useEffect(() => {
    const allowed = ROLE_NAV_SECTIONS[effectiveRole] ?? ['dashboard'];
    if (!allowed.includes(activeSection)) {
      setActiveSection(allowed[0]);
    }
  }, [effectiveRole, activeSection]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-[#0B1120] text-slate-600 dark:text-slate-300 text-sm">
        Initializing EDUVANCE ERP session...
      </div>
    );
  }

  if (!firebaseUser || viewMode === 'public') {
    return <PublicPortal data={data} onEnterWorkspace={() => setViewMode('erp')} />;
  }

  if (effectiveRole === 'student' && !isSuperAdmin && myStudent && myStudent.accountActivated === false) {
    return <StudentActivationGate student={myStudent} data={data} />;
  }

  return (
    <ErpLayout
      activeSection={activeSection}
      onSelectSection={setActiveSection}
      onBackToPublic={() => setViewMode('public')}
      unreadResourcesAlerts={unreadResourcesAlerts}
    >
      {activeSection === 'dashboard' && (
        <DashboardModule data={data} onNavigate={setActiveSection} />
      )}
      {activeSection === 'admissions' && <AdmissionsModule data={data} />}
      {activeSection === 'students' && <StudentsAcademicsModule mode="students" data={data} />}
      {activeSection === 'academics' && <StudentsAcademicsModule mode="academics" data={data} />}
      {activeSection === 'resources' && <ResourcesModule data={data} />}
      {activeSection === 'finance' && <FinanceModule data={data} />}
      {activeSection === 'hr' && <HrPayrollModule data={data} />}
      {activeSection === 'governance' && <GovernanceModule data={data} />}
      {activeSection === 'services' && <ServicesModule data={data} />}
    </ErpLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <ErpRouter />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
