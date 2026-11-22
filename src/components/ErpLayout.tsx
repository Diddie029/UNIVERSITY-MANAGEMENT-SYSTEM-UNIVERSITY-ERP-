import React, { useState } from 'react';
import {
  BookOpen,
  BookOpenCheck,
  Building2,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Moon,
  Shield,
  Sun,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ErpSection, ROLE_LABELS, ROLE_NAV_SECTIONS, UserRole } from '../types/erp';

interface ErpLayoutProps {
  activeSection: ErpSection;
  onSelectSection: (section: ErpSection) => void;
  onBackToPublic: () => void;
  unreadResourcesAlerts?: number;
  children: React.ReactNode;
}

const NAV_ITEMS: { id: ErpSection; label: string; icon: React.FC<{ className?: string }> }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'admissions', label: 'Admissions', icon: UserCheck },
  { id: 'students', label: 'Students & Clearance', icon: GraduationCap },
  { id: 'academics', label: 'Academics & Exams', icon: BookOpenCheck },
  { id: 'resources', label: 'Resources & E-Learning', icon: BookOpen },
  { id: 'finance', label: 'Finance & Paybill', icon: CreditCard },
  { id: 'hr', label: 'HR & Payroll', icon: Users },
  { id: 'governance', label: 'Governance & Audit', icon: Shield },
  { id: 'services', label: 'Notices & Helpdesk', icon: MessageSquare },
];

export function ErpLayout({
  activeSection,
  onSelectSection,
  onBackToPublic,
  unreadResourcesAlerts = 0,
  children,
}: ErpLayoutProps) {
  const { firebaseUser, profile, effectiveRole, previewRole, setPreviewRole, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);

  const allowedSections = ROLE_NAV_SECTIONS[effectiveRole] ?? ['dashboard', 'services'];
  const getLabel = (item: { id: ErpSection; label: string }) => {
    if (effectiveRole === 'student') {
      if (item.id === 'students') return 'My Profile & Clearance';
      if (item.id === 'academics') return 'My Units & Results';
      if (item.id === 'resources') return 'Resources & Online Classes';
      if (item.id === 'finance') return 'My Fees & Paybill';
    }
    if (effectiveRole === 'applicant' && item.id === 'admissions') {
      return 'My Applications';
    }
    return item.label;
  };
  const visibleNav = NAV_ITEMS.filter((item) => allowedSections.includes(item.id)).map((item) => ({
    ...item,
    label: getLabel(item),
  }));
  const currentTitle = visibleNav.find((i) => i.id === activeSection)?.label ?? 'Workspace';
  const isSuperAdmin = profile?.role === 'super_admin';

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="h-16 px-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBackToPublic}
          className="flex items-center gap-2.5 text-left group"
        >
          <div className="w-8 h-8 rounded-lg bg-amber-600/15 border border-amber-500/30 flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4 text-amber-500" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900 dark:text-white truncate font-display">PUST ERP</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">University Ecosystem</p>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-slate-500 hover:text-slate-900 dark:hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectSection(item.id);
                setMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                active
                  ? 'bg-amber-600 text-white'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{item.label}</span>
              {item.id === 'resources' && unreadResourcesAlerts > 0 && (
                <span
                  className={`ml-auto font-mono tabular-nums text-[11px] font-bold px-1.5 py-0.5 rounded shrink-0 ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {unreadResourcesAlerts}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {isSuperAdmin && (
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5">
          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400">
            Portal Role Preview
          </label>
          <select
            value={previewRole ?? 'super_admin'}
            onChange={(e) => {
              const val = e.target.value as UserRole;
              setPreviewRole(val === 'super_admin' ? null : val);
            }}
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
          >
            {(Object.keys(ROLE_LABELS) as UserRole[]).map((roleKey) => (
              <option key={roleKey} value={roleKey}>
                {ROLE_LABELS[roleKey]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
        <div className="px-2 py-1">
          <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
            {profile?.displayName || firebaseUser?.displayName || 'Portal User'}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {ROLE_LABELS[effectiveRole]}
          </p>
        </div>
        <button
          type="button"
          onClick={() => signOut()}
          className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-[#0B1120] text-slate-900 dark:text-slate-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] sticky top-0 h-screen no-print">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative w-64 max-w-[80vw] bg-white dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800 h-full z-10">
            {sidebarContent}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 px-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] flex items-center justify-between gap-4 sticky top-0 z-20 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-500 dark:text-slate-400 hidden sm:inline">PUST ERP</span>
              <span className="text-slate-400 hidden sm:inline">/</span>
              <h1 className="font-semibold text-slate-900 dark:text-white truncate">{currentTitle}</h1>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Toggle dark or light mode"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-amber-500 transition-colors whitespace-nowrap"
            >
              {theme === 'dark' ? (
                <Sun className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Moon className="w-3.5 h-3.5 text-slate-700" />
              )}
              <span className="hidden sm:inline">{theme === 'dark' ? 'Light' : 'Dark'}</span>
            </button>
            <button
              type="button"
              onClick={onBackToPublic}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              Public Portal
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 max-w-[1440px] w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
