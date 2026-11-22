import React, { useState } from 'react';
import { deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore';
import { Bell, CheckCircle2, LifeBuoy, Pin, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { ErpDataset } from '../hooks/useErpData';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { Notice, NoticeCategory, SupportTicket } from '../types/erp';

interface ServicesModuleProps {
  data: ErpDataset;
}

const NOTICE_CATEGORIES: NoticeCategory[] = [
  'Admission Intake',
  'Academic Circular',
  'Campus Event',
  'Fee & Finance',
  'Scholarship / Advert',
];

export function ServicesModule({ data }: ServicesModuleProps) {
  const { firebaseUser, profile, effectiveRole } = useAuth();
  const { showToast } = useToast();

  const canPublishNotice = ['super_admin', 'management', 'admissions', 'lecturer', 'hod', 'exam_officer'].includes(
    effectiveRole
  );
  const canManageNotices = ['super_admin', 'management'].includes(effectiveRole);
  const canResolveTickets = ['super_admin', 'management', 'admissions', 'finance'].includes(effectiveRole);

  const [noticeTitle, setNoticeTitle] = useState('');
  const [noticeBody, setNoticeBody] = useState('');
  const [noticeCategory, setNoticeCategory] = useState<NoticeCategory>('Admission Intake');
  const [noticeAudience, setNoticeAudience] = useState<'All' | 'Students' | 'Staff'>('All');
  const [noticePinned, setNoticePinned] = useState(true);
  const [noticeEventDate, setNoticeEventDate] = useState('');
  const [noticeCta, setNoticeCta] = useState('');

  const [ticketCategory, setTicketCategory] = useState<SupportTicket['category']>('Academic');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketDesc, setTicketDesc] = useState('');

  const handlePublishNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const id = makeId('not');
    try {
      await setDoc(doc(db, 'notices', id), {
        title: clampStr(noticeTitle, 200),
        body: clampStr(noticeBody, 2000),
        category: noticeCategory,
        audience: noticeAudience,
        pinned: noticePinned,
        eventDate: clampStr(noticeEventDate, 32),
        ctaLabel: clampStr(noticeCta, 64),
        authorName: clampStr(profile.displayName, 120),
        createdAt: new Date().toISOString(),
      });
      showToast('Official notice published to Landing Page Notice Board & ERP.', 'success');
      setNoticeTitle('');
      setNoticeBody('');
      setNoticeEventDate('');
      setNoticeCta('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `notices/${id}`);
    }
  };

  const handleTogglePin = async (notice: Notice) => {
    try {
      await updateDoc(doc(db, 'notices', notice.id), {
        pinned: !Boolean(notice.pinned),
      });
      showToast(notice.pinned ? 'Notice unpinned from featured adverts.' : 'Notice pinned on Landing Page.', 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `notices/${notice.id}`);
    }
  };

  const handleDeleteNotice = async (noticeId: string) => {
    try {
      await deleteDoc(doc(db, 'notices', noticeId));
      showToast('Notice removed from Notice Board.', 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `notices/${noticeId}`);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const id = makeId('tkt');
    const now = new Date().toISOString();
    try {
      await setDoc(doc(db, 'support_tickets', id), {
        requesterUid: firebaseUser.uid,
        requesterName: clampStr(profile.displayName, 160),
        category: ticketCategory,
        subject: clampStr(ticketSubject, 200),
        description: clampStr(ticketDesc, 2000),
        status: 'open',
        resolutionNote: '',
        assignedTo: '',
        createdAt: now,
        updatedAt: now,
      });
      showToast('Support ticket logged. Relevant office notified.', 'success');
      setTicketSubject('');
      setTicketDesc('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `support_tickets/${id}`);
    }
  };

  const handleResolveTicket = async (ticket: SupportTicket) => {
    if (!profile) return;
    try {
      await updateDoc(doc(db, 'support_tickets', ticket.id), {
        status: 'resolved',
        assignedTo: clampStr(profile.displayName, 120),
        resolutionNote: 'Verified and resolved by University Desk.',
        updatedAt: new Date().toISOString(),
      });
      showToast(`Ticket "${ticket.subject}" resolved.`, 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `support_tickets/${ticket.id}`);
    }
  };

  const sortedNotices = [...data.notices].sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white">
          Notice Board, Campus Adverts &amp; Service Desk
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Publish school circulars, admission intake adverts, and events directly to the public landing page notice board.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Notices & Campus Adverts Column */}
        <div className="lg:col-span-6 space-y-4">
          {canPublishNotice && (
            <form
              onSubmit={handlePublishNotice}
              className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-500" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  Publish Notice / Campus Advert
                </h3>
              </div>

              <input
                type="text"
                required
                value={noticeTitle}
                onChange={(e) => setNoticeTitle(e.target.value)}
                placeholder="Headline (e.g. September 2027 Intake Now Open)"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />

              <textarea
                rows={3}
                required
                value={noticeBody}
                onChange={(e) => setNoticeBody(e.target.value)}
                placeholder="Circular or advertisement details for students, staff, and prospective applicants..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={noticeCategory}
                  onChange={(e) => setNoticeCategory(e.target.value as NoticeCategory)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  {NOTICE_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
                <select
                  value={noticeAudience}
                  onChange={(e) => setNoticeAudience(e.target.value as 'All' | 'Students' | 'Staff')}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="All">Audience: All</option>
                  <option value="Students">Audience: Students</option>
                  <option value="Staff">Audience: Staff</option>
                </select>
                <input
                  type="date"
                  value={noticeEventDate}
                  onChange={(e) => setNoticeEventDate(e.target.value)}
                  aria-label="Event or deadline date"
                  className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                <select
                  value={noticeCta}
                  onChange={(e) => setNoticeCta(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
                >
                  <option value="">No Landing CTA Button</option>
                  <option value="Apply for Admission">CTA: Apply for Admission</option>
                  <option value="View Fee Schedule">CTA: View Fee Schedule</option>
                  <option value="Portal Sign In">CTA: Portal Sign In</option>
                </select>

                <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noticePinned}
                    onChange={(e) => setNoticePinned(e.target.checked)}
                    className="rounded border-slate-400 text-amber-600 focus:ring-amber-500"
                  />
                  <span>Pin &amp; Advertise on Landing Board</span>
                </label>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Publish to Notice Board</span>
                </button>
              </div>
            </form>
          )}

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y divide-slate-200 dark:divide-slate-800">
            {sortedNotices.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 dark:text-slate-400">No university notices published yet.</p>
            ) : (
              sortedNotices.map((n) => (
                <div key={n.id} className="p-5 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {n.pinned ? 'Featured Advert · ' : ''}
                        {n.category || 'Academic Circular'} · {n.audience}
                        {n.eventDate ? ` · ${n.eventDate}` : ''}
                      </p>
                      <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{n.title}</h4>
                    </div>
                    {canManageNotices && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTogglePin(n)}
                          title={n.pinned ? 'Unpin notice' : 'Pin notice'}
                          className={`p-1.5 rounded-md border ${
                            n.pinned
                              ? 'border-amber-500/50 text-amber-500 bg-amber-500/10'
                              : 'border-slate-200 dark:border-slate-700 text-slate-400'
                          }`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteNotice(n.id)}
                          title="Delete notice"
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-500 hover:border-red-500/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{n.body}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">Issued by {n.authorName}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Support Tickets Column */}
        <div className="lg:col-span-6 space-y-4">
          <form
            onSubmit={handleCreateTicket}
            className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-3"
          >
            <div className="flex items-center gap-2">
              <LifeBuoy className="w-4 h-4 text-amber-500" />
              <h3 className="text-sm font-semibold">Submit Support Ticket / Complaint</h3>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <select
                value={ticketCategory}
                onChange={(e) => setTicketCategory(e.target.value as SupportTicket['category'])}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              >
                {['Academic', 'Finance', 'Admissions', 'ICT', 'Welfare'].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={ticketSubject}
                onChange={(e) => setTicketSubject(e.target.value)}
                placeholder="Ticket Subject"
                className="sm:col-span-2 px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
              />
            </div>
            <textarea
              rows={2}
              required
              value={ticketDesc}
              onChange={(e) => setTicketDesc(e.target.value)}
              placeholder="Describe the issue clearly..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900"
            />
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
              >
                Submit Ticket
              </button>
            </div>
          </form>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] divide-y divide-slate-200 dark:divide-slate-800">
            {data.tickets.length === 0 ? (
              <p className="p-6 text-sm text-slate-500 dark:text-slate-400">No support tickets logged yet.</p>
            ) : (
              data.tickets.map((t) => (
                <div key={t.id} className="p-4 flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-slate-500">
                      {t.category} · {t.requesterName} ·{' '}
                      <span
                        className={`font-semibold uppercase ${
                          t.status === 'resolved'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {t.status}
                      </span>
                    </p>
                    <p className="text-sm font-semibold">{t.subject}</p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">{t.description}</p>
                  </div>
                  {canResolveTickets && t.status !== 'resolved' && (
                    <button
                      type="button"
                      onClick={() => handleResolveTicket(t)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Resolve</span>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
