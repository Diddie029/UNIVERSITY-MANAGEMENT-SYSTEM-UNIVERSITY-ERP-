import React, { useEffect, useMemo, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import {
  Archive,
  BookOpen,
  Check,
  ExternalLink,
  LogOut,
  MessageSquare,
  Plus,
  Save,
  Send,
  Share2,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { clampStr, db, handleFirestoreError, makeId, OperationType } from '../lib/firebase';
import { recordAuditLog } from '../lib/erpService';
import {
  Course,
  CourseResource,
  Student,
  StudyGroup,
  StudyGroupMember,
  StudyGroupMessage,
} from '../types/erp';

interface StudyGroupsPanelProps {
  courses: Course[];
  courseResources: CourseResource[];
  studyGroups: StudyGroup[];
  joinedGroupIds: Set<string>;
  filterCourseId: string;
  searchQuery: string;
  myRegisteredCourseIds: Set<string>;
  myStudent?: Student;
  isAcademicStaff: boolean;
  isSuperAdmin: boolean;
  showCreateForm: boolean;
  onToggleCreateForm: (open: boolean) => void;
}

type GroupScopeFilter = 'active' | 'mine' | 'archived';

export function StudyGroupsPanel({
  courses,
  courseResources,
  studyGroups,
  joinedGroupIds,
  filterCourseId,
  searchQuery,
  myRegisteredCourseIds,
  myStudent,
  isAcademicStaff,
  isSuperAdmin,
  showCreateForm,
  onToggleCreateForm,
}: StudyGroupsPanelProps) {
  const { firebaseUser, profile } = useAuth();
  const { showToast } = useToast();

  const [scopeFilter, setScopeFilter] = useState<GroupScopeFilter>('active');
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);

  // Create Group Form State
  const defaultCourseId =
    filterCourseId !== 'all' && filterCourseId !== 'my_registered'
      ? filterCourseId
      : courses[0]?.id || '';
  const [formCourseId, setFormCourseId] = useState(defaultCourseId);
  const [formName, setFormName] = useState('');
  const [formTopic, setFormTopic] = useState('');
  const [formSchedule, setFormSchedule] = useState('');
  const [formMaxMembers, setFormMaxMembers] = useState('15');
  const [formMeetingUrl, setFormMeetingUrl] = useState('');
  const [formInitialNotes, setFormInitialNotes] = useState('');
  const [creatingGroup, setCreatingGroup] = useState(false);

  // Active Collaborative Room Modal State
  const [activeGroup, setActiveGroup] = useState<StudyGroup | null>(null);
  const [roomMembers, setRoomMembers] = useState<StudyGroupMember[]>([]);
  const [roomMessages, setRoomMessages] = useState<StudyGroupMessage[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [selectedResourceToShare, setSelectedResourceToShare] = useState('');

  // Shared Revision Notes Pad State
  const [notesDraft, setNotesDraft] = useState('');
  const [notesDirty, setNotesDirty] = useState(false);
  const [savingNotes, setSavingNotes] = useState(false);

  const actorDisplayName = useMemo(() => {
    const raw = myStudent?.fullName || profile?.displayName || 'PUST Member';
    const trimmed = clampStr(raw, 160);
    return trimmed.length >= 2 ? trimmed : 'PUST Member';
  }, [myStudent?.fullName, profile?.displayName]);

  const actorAdmissionNo = myStudent?.admissionNo || '';

  // Sync activeGroup live updates from Firestore dataset
  useEffect(() => {
    if (!activeGroup) return;
    const latest = studyGroups.find((g) => g.id === activeGroup.id);
    if (!latest) {
      setActiveGroup(null);
      return;
    }
    setActiveGroup(latest);
    if (!notesDirty) {
      setNotesDraft(latest.sharedNotes || '');
    }
  }, [studyGroups, activeGroup, notesDirty]);

  // Subscribe to live members & messages when a room is opened
  useEffect(() => {
    if (!activeGroup) {
      setRoomMembers([]);
      setRoomMessages([]);
      return;
    }

    const membersUnsub = onSnapshot(
      collection(db, 'study_groups', activeGroup.id, 'members'),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StudyGroupMember, 'id'>) }))
          .sort((a, b) => {
            if (a.role !== b.role) return a.role === 'host' ? -1 : 1;
            return a.joinedAt.localeCompare(b.joinedAt);
          });
        setRoomMembers(list);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `study_groups/${activeGroup.id}/members`);
      }
    );

    const messagesUnsub = onSnapshot(
      query(collection(db, 'study_groups', activeGroup.id, 'messages'), orderBy('createdAt', 'asc')),
      (snap) => {
        setRoomMessages(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StudyGroupMessage, 'id'>) }))
        );
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `study_groups/${activeGroup.id}/messages`);
      }
    );

    return () => {
      membersUnsub();
      messagesUnsub();
    };
  }, [activeGroup?.id]);

  const filteredGroups = useMemo(() => {
    return studyGroups
      .filter((g) => {
        if (scopeFilter === 'active' && g.status !== 'active') return false;
        if (scopeFilter === 'archived' && g.status !== 'archived') return false;
        if (scopeFilter === 'mine' && !joinedGroupIds.has(g.id)) return false;

        if (filterCourseId === 'my_registered') {
          if (myRegisteredCourseIds.size > 0 && !myRegisteredCourseIds.has(g.courseId)) return false;
        } else if (filterCourseId !== 'all' && g.courseId !== filterCourseId) {
          return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const haystack = `${g.name} ${g.courseCode} ${g.courseTitle} ${g.topic} ${g.creatorName}`.toLowerCase();
          if (!haystack.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [studyGroups, scopeFilter, joinedGroupIds, filterCourseId, myRegisteredCourseIds, searchQuery]);

  const courseMaterialsForActiveRoom = useMemo(() => {
    if (!activeGroup) return [];
    return courseResources.filter((r) => r.courseId === activeGroup.courseId);
  }, [activeGroup, courseResources]);

  const openRoom = (group: StudyGroup) => {
    setActiveGroup(group);
    setNotesDraft(group.sharedNotes || '');
    setNotesDirty(false);
    setChatDraft('');
    setSelectedResourceToShare('');
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    const cId = formCourseId || defaultCourseId;
    const course = courses.find((c) => c.id === cId);
    if (!course) {
      showToast('Select a valid course unit for this study group.', 'error');
      return;
    }

    const cleanName = clampStr(formName, 160);
    const cleanTopic = clampStr(formTopic, 500);
    if (cleanName.length < 2 || cleanTopic.length < 2) {
      showToast('Enter both a study group name and focus topic.', 'error');
      return;
    }

    const maxMembers = Math.min(50, Math.max(2, Number(formMaxMembers) || 15));
    const groupId = makeId('sg');
    const msgId = makeId('sgmsg');
    const now = new Date().toISOString();

    const newGroupPayload: Omit<StudyGroup, 'id'> = {
      courseId: course.id,
      courseCode: course.code,
      courseTitle: course.title,
      name: cleanName,
      topic: cleanTopic,
      scheduleNote: clampStr(formSchedule, 160),
      meetingUrl: clampStr(formMeetingUrl, 500),
      sharedNotes: clampStr(formInitialNotes, 8000),
      sharedNotesUpdatedBy: formInitialNotes.trim() ? actorDisplayName : '',
      status: 'active',
      maxMembers,
      memberCount: 1,
      creatorUid: firebaseUser.uid,
      creatorName: actorDisplayName,
      creatorAdmissionNo: clampStr(actorAdmissionNo, 64),
      createdAt: now,
      updatedAt: now,
    };

    setCreatingGroup(true);
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'study_groups', groupId), newGroupPayload);
      batch.set(doc(db, 'study_groups', groupId, 'members', firebaseUser.uid), {
        groupId,
        uid: firebaseUser.uid,
        studentId: myStudent?.id || '',
        admissionNo: clampStr(actorAdmissionNo, 64),
        displayName: actorDisplayName,
        role: 'host',
        joinedAt: now,
      });
      batch.set(doc(db, 'users', firebaseUser.uid, 'study_group_memberships', groupId), {
        uid: firebaseUser.uid,
        groupId,
        role: 'host',
        joinedAt: now,
      });
      batch.set(doc(db, 'study_groups', groupId, 'messages', msgId), {
        groupId,
        senderUid: firebaseUser.uid,
        senderName: actorDisplayName,
        senderAdmissionNo: clampStr(actorAdmissionNo, 64),
        kind: 'system',
        body: `Created the ${course.code} study room "${cleanName}".`,
        createdAt: now,
      });

      await batch.commit();

      await recordAuditLog(
        { uid: firebaseUser.uid, name: actorDisplayName, role: profile.role },
        'STUDY_GROUP_CREATED',
        `study_groups/${groupId}`,
        `Created ${course.code} study group "${cleanName}" (max ${maxMembers} members).`
      );

      showToast(`Created study group "${cleanName}" for ${course.code}.`, 'success');
      onToggleCreateForm(false);
      setFormName('');
      setFormTopic('');
      setFormSchedule('');
      setFormMeetingUrl('');
      setFormInitialNotes('');
      openRoom({ id: groupId, ...newGroupPayload });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `study_groups/${groupId}`);
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleJoinGroup = async (group: StudyGroup) => {
    if (!firebaseUser) return;
    if (joinedGroupIds.has(group.id)) {
      openRoom(group);
      return;
    }
    if (group.status !== 'active') {
      showToast('This study group has been archived by its host.', 'error');
      return;
    }
    if (group.memberCount >= group.maxMembers) {
      showToast('This study group has reached its member capacity.', 'error');
      return;
    }

    setBusyGroupId(group.id);
    const now = new Date().toISOString();
    const msgId = makeId('sgmsg');
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'study_groups', group.id), {
        memberCount: group.memberCount + 1,
        updatedAt: now,
      });
      batch.set(doc(db, 'study_groups', group.id, 'members', firebaseUser.uid), {
        groupId: group.id,
        uid: firebaseUser.uid,
        studentId: myStudent?.id || '',
        admissionNo: clampStr(actorAdmissionNo, 64),
        displayName: actorDisplayName,
        role: 'member',
        joinedAt: now,
      });
      batch.set(doc(db, 'users', firebaseUser.uid, 'study_group_memberships', group.id), {
        uid: firebaseUser.uid,
        groupId: group.id,
        role: 'member',
        joinedAt: now,
      });
      batch.set(doc(db, 'study_groups', group.id, 'messages', msgId), {
        groupId: group.id,
        senderUid: firebaseUser.uid,
        senderName: actorDisplayName,
        senderAdmissionNo: clampStr(actorAdmissionNo, 64),
        kind: 'system',
        body: `${actorDisplayName}${actorAdmissionNo ? ` (${actorAdmissionNo})` : ''} joined the study room.`,
        createdAt: now,
      });

      await batch.commit();
      showToast(`Joined "${group.name}".`, 'success');
      openRoom({ ...group, memberCount: group.memberCount + 1, updatedAt: now });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `study_groups/${group.id}/join`);
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleLeaveGroup = async (group: StudyGroup) => {
    if (!firebaseUser) return;
    if (group.creatorUid === firebaseUser.uid) {
      showToast('Room hosts can archive or delete the group instead of leaving.', 'info');
      return;
    }

    setBusyGroupId(group.id);
    const now = new Date().toISOString();
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'study_groups', group.id), {
        memberCount: Math.max(0, group.memberCount - 1),
        updatedAt: now,
      });
      batch.delete(doc(db, 'study_groups', group.id, 'members', firebaseUser.uid));
      batch.delete(doc(db, 'users', firebaseUser.uid, 'study_group_memberships', group.id));
      await batch.commit();

      if (activeGroup?.id === group.id) {
        setActiveGroup(null);
      }
      showToast(`Left "${group.name}".`, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `study_groups/${group.id}/leave`);
    } finally {
      setBusyGroupId(null);
    }
  };

  const handleToggleGroupStatus = async (group: StudyGroup) => {
    const nextStatus = group.status === 'active' ? 'archived' : 'active';
    try {
      await updateDoc(doc(db, 'study_groups', group.id), {
        status: nextStatus,
        updatedAt: new Date().toISOString(),
      });
      showToast(
        nextStatus === 'archived' ? `Archived "${group.name}".` : `Reopened "${group.name}".`,
        'success'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `study_groups/${group.id}`);
    }
  };

  const handleDeleteGroup = async (group: StudyGroup) => {
    try {
      await deleteDoc(doc(db, 'study_groups', group.id));
      if (firebaseUser) {
        try {
          await deleteDoc(doc(db, 'users', firebaseUser.uid, 'study_group_memberships', group.id));
        } catch {
          // Membership index may not exist if admin deletes another user's group
        }
      }
      if (activeGroup?.id === group.id) {
        setActiveGroup(null);
      }
      showToast(`Deleted study group "${group.name}".`, 'info');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `study_groups/${group.id}`);
    }
  };

  const handleSaveSharedNotes = async () => {
    if (!activeGroup || !firebaseUser) return;
    setSavingNotes(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'study_groups', activeGroup.id), {
        sharedNotes: clampStr(notesDraft, 8000),
        sharedNotesUpdatedBy: actorDisplayName,
        updatedAt: now,
      });
      setNotesDirty(false);
      showToast('Saved shared study notes for all room members.', 'success');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `study_groups/${activeGroup.id}`);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleSendRoomMessage = async (
    kind: 'chat' | 'resource_share',
    customBody?: string
  ) => {
    if (!activeGroup || !firebaseUser) return;
    const body = clampStr(customBody ?? chatDraft, 1500);
    if (!body) return;

    setSendingMessage(true);
    const msgId = makeId('sgmsg');
    try {
      await setDoc(doc(db, 'study_groups', activeGroup.id, 'messages', msgId), {
        groupId: activeGroup.id,
        senderUid: firebaseUser.uid,
        senderName: actorDisplayName,
        senderAdmissionNo: clampStr(actorAdmissionNo, 64),
        kind,
        body,
        createdAt: new Date().toISOString(),
      });
      if (kind === 'chat') {
        setChatDraft('');
      } else {
        setSelectedResourceToShare('');
        showToast('Shared course resource reference with the study group.', 'success');
      }
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.CREATE,
        `study_groups/${activeGroup.id}/messages/${msgId}`
      );
    } finally {
      setSendingMessage(false);
    }
  };

  const activeCount = studyGroups.filter((g) => g.status === 'active').length;
  const joinedCount = studyGroups.filter((g) => joinedGroupIds.has(g.id)).length;
  const archivedCount = studyGroups.filter((g) => g.status === 'archived').length;

  return (
    <div className="space-y-6">
      {/* Scope Filter Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
          {(
            [
              { id: 'active', label: `Active Rooms (${activeCount})` },
              { id: 'mine', label: `My Joined Groups (${joinedCount})` },
              { id: 'archived', label: `Archived (${archivedCount})` },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setScopeFilter(item.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                scopeFilter === item.id
                  ? 'bg-white dark:bg-[#1E293B] text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">
          Peer-led course rooms with live chat, shared revision notes, and resource sharing.
        </p>
      </div>

      {/* Create Study Group Form */}
      {showCreateForm && (
        <form
          onSubmit={handleCreateGroup}
          className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 space-y-4"
        >
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Launch a Collaborative Course Study Group
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Create a virtual room for peers enrolled in a unit to revise together.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onToggleCreateForm(false)}
              aria-label="Close create study group form"
              className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Course Unit
              </label>
              <select
                value={formCourseId || defaultCourseId}
                onChange={(e) => setFormCourseId(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Study Group Name
              </label>
              <input
                type="text"
                required
                minLength={2}
                maxLength={160}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="e.g. CSC 201 Evening CAT Revision Squad"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Max Participants (2–50)
              </label>
              <input
                type="number"
                min={2}
                max={50}
                required
                value={formMaxMembers}
                onChange={(e) => setFormMaxMembers(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono tabular-nums rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                Meetup Schedule / Cadence (Optional)
              </label>
              <input
                type="text"
                maxLength={160}
                value={formSchedule}
                onChange={(e) => setFormSchedule(e.target.value)}
                placeholder="e.g. Mon & Thu · 7:30 PM EAT"
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                External Video Call URL (Optional Google Meet / Zoom)
              </label>
              <input
                type="url"
                maxLength={500}
                value={formMeetingUrl}
                onChange={(e) => setFormMeetingUrl(e.target.value)}
                placeholder="https://meet.google.com/..."
                className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Study Focus &amp; Goals
            </label>
            <input
              type="text"
              required
              minLength={2}
              maxLength={500}
              value={formTopic}
              onChange={(e) => setFormTopic(e.target.value)}
              placeholder="e.g. Solving past paper tree balancing questions and preparing for Assignment 1."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
              Initial Shared Study Notes / Agenda (Optional)
            </label>
            <textarea
              rows={3}
              maxLength={8000}
              value={formInitialNotes}
              onChange={(e) => setFormInitialNotes(e.target.value)}
              placeholder="Outline key chapters, formulas, or questions for group members to collaborate on..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onToggleCreateForm(false)}
              className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creatingGroup}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{creatingGroup ? 'Creating Room...' : 'Create Study Group'}</span>
            </button>
          </div>
        </form>
      )}

      {/* Study Groups Grid */}
      {filteredGroups.length === 0 ? (
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {scopeFilter === 'mine'
              ? 'You have not joined any study groups yet.'
              : scopeFilter === 'archived'
              ? 'No archived study groups match the current course filter.'
              : 'No active study groups match the current filter.'}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Start a collaborative room for your course unit so classmates can share revision notes and discuss assignments.
          </p>
          {scopeFilter !== 'archived' && (
            <button
              type="button"
              onClick={() => onToggleCreateForm(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Study Group</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {filteredGroups.map((group) => {
            const isJoined = joinedGroupIds.has(group.id);
            const isHost = group.creatorUid === firebaseUser?.uid;
            const isFull = group.memberCount >= group.maxMembers;
            const isBusy = busyGroupId === group.id;

            return (
              <article
                key={group.id}
                className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-[#111827] p-5 flex flex-col justify-between gap-4"
              >
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500 dark:text-slate-400">
                      <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                        {group.courseCode}
                      </span>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {group.memberCount}/{group.maxMembers} members
                      </span>
                      {group.scheduleNote && (
                        <>
                          <span className="mx-1.5" aria-hidden="true">·</span>
                          <span>{group.scheduleNote}</span>
                        </>
                      )}
                    </span>
                    <span
                      className={`font-semibold uppercase ${
                        group.status === 'active'
                          ? isJoined
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {group.status === 'archived'
                        ? 'Archived'
                        : isJoined
                        ? 'Joined'
                        : isFull
                        ? 'Full'
                        : 'Open'}
                    </span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 dark:text-white leading-snug">
                    {group.name}
                  </h3>

                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Host: {group.creatorName}
                    {group.creatorAdmissionNo ? ` (${group.creatorAdmissionNo})` : ''} · {group.courseTitle}
                  </p>

                  <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    {group.topic}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-center gap-2">
                    {isJoined ? (
                      <button
                        type="button"
                        onClick={() => openRoom(group)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        <span>Enter Study Room</span>
                      </button>
                    ) : group.status === 'active' && !isFull ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleJoinGroup(group)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-60"
                      >
                        <UserPlus className="w-3.5 h-3.5" />
                        <span>{isBusy ? 'Joining...' : 'Join & Enter Room'}</span>
                      </button>
                    ) : null}

                    {!isJoined && isAcademicStaff && (
                      <button
                        type="button"
                        onClick={() => openRoom(group)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200"
                      >
                        <Users className="w-3.5 h-3.5" />
                        <span>Inspect Room</span>
                      </button>
                    )}

                    {group.meetingUrl && isJoined && (
                      <a
                        href={group.meetingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 hover:border-amber-500 text-slate-700 dark:text-slate-200"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Video Call</span>
                      </a>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isJoined && !isHost && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleLeaveGroup(group)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-red-500/60 hover:text-red-600 dark:hover:text-red-400"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Leave</span>
                      </button>
                    )}

                    {(isHost || isSuperAdmin) && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleToggleGroupStatus(group)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-500"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          <span>{group.status === 'active' ? 'Archive' : 'Reopen'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteGroup(group)}
                          aria-label={`Delete ${group.name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* ===================================================================== */}
      {/* COLLABORATIVE VIRTUAL STUDY ROOM MODAL                                */}
      {/* ===================================================================== */}
      {activeGroup && (
        <div className="fixed inset-0 z-50 bg-black/65 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] overflow-hidden">
            {/* Room Header */}
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                    {activeGroup.courseCode}
                  </span>
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    {activeGroup.memberCount}/{activeGroup.maxMembers} members
                  </span>
                  {activeGroup.scheduleNote && (
                    <>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span>{activeGroup.scheduleNote}</span>
                    </>
                  )}
                  <span className="mx-1.5" aria-hidden="true">·</span>
                  <span className="uppercase font-semibold">{activeGroup.status}</span>
                </p>
                <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                  {activeGroup.name}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {activeGroup.meetingUrl && (
                  <a
                    href={activeGroup.meetingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Join Video Call</span>
                  </a>
                )}

                {joinedGroupIds.has(activeGroup.id) && activeGroup.creatorUid !== firebaseUser?.uid && (
                  <button
                    type="button"
                    disabled={busyGroupId === activeGroup.id}
                    onClick={() => handleLeaveGroup(activeGroup)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-red-500 hover:text-red-600"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Leave Room</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveGroup(null)}
                  aria-label="Close study room"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Two-Column Collaboration Canvas */}
            <div className="grid grid-cols-1 md:grid-cols-12 flex-1 min-h-0 overflow-hidden">
              {/* Left Column: Roster + Shared Revision Notes Pad */}
              <div className="md:col-span-5 p-5 border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 space-y-5 overflow-y-auto">
                <div className="space-y-1.5">
                  <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Study Focus
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {activeGroup.topic}
                  </p>
                </div>

                {/* Live Member Roster */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <h4 className="font-semibold text-slate-700 dark:text-slate-300">
                      Room Members (
                      <span className="font-mono tabular-nums">{roomMembers.length}</span>)
                    </h4>
                    <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      Cap {activeGroup.maxMembers}
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                    {roomMembers.length === 0 ? (
                      <p className="p-3 text-xs text-slate-500 dark:text-slate-400">
                        Loading participants...
                      </p>
                    ) : (
                      roomMembers.map((member) => (
                        <div
                          key={member.id}
                          className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900 dark:text-white truncate">
                              {member.displayName}
                            </p>
                            {member.admissionNo && (
                              <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                {member.admissionNo}
                              </p>
                            )}
                          </div>
                          <span
                            className={`font-mono text-[11px] uppercase font-semibold shrink-0 ${
                              member.role === 'host'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {member.role}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Collaborative Shared Study Notes Pad */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Collaborative Study Pad
                    </h4>
                    {activeGroup.sharedNotesUpdatedBy && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        Last edit: {activeGroup.sharedNotesUpdatedBy}
                      </span>
                    )}
                  </div>

                  <textarea
                    rows={7}
                    maxLength={8000}
                    disabled={activeGroup.status !== 'active' || (!joinedGroupIds.has(activeGroup.id) && !isSuperAdmin && !isAcademicStaff)}
                    value={notesDraft}
                    onChange={(e) => {
                      setNotesDraft(e.target.value);
                      setNotesDirty(true);
                    }}
                    placeholder="Write shared revision summaries, formulas, or exam practice checkpoints with your group..."
                    className="w-full px-3 py-2 text-xs leading-relaxed rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {notesDirty && activeGroup.sharedNotes !== notesDraft ? (
                      <button
                        type="button"
                        onClick={() => {
                          setNotesDraft(activeGroup.sharedNotes || '');
                          setNotesDirty(false);
                        }}
                        className="text-xs text-amber-600 dark:text-amber-400 hover:underline"
                      >
                        Reset to Latest Saved
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        {notesDraft.length}/8000 chars
                      </span>
                    )}

                    {activeGroup.status === 'active' &&
                      (joinedGroupIds.has(activeGroup.id) || isSuperAdmin || isAcademicStaff) && (
                        <button
                          type="button"
                          disabled={savingNotes || !notesDirty}
                          onClick={handleSaveSharedNotes}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                        >
                          {savingNotes ? (
                            <span>Saving...</span>
                          ) : notesDirty ? (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              <span>Save Shared Notes</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Synced</span>
                            </>
                          )}
                        </button>
                      )}
                  </div>
                </div>
              </div>

              {/* Right Column: Live Group Chat & Course Resource Sharing */}
              <div className="md:col-span-7 flex flex-col min-h-[360px] max-h-[68vh]">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Live Study Room Discussion
                  </span>

                  {courseMaterialsForActiveRoom.length > 0 && activeGroup.status === 'active' && (
                    <div className="flex items-center gap-1.5">
                      <select
                        value={selectedResourceToShare}
                        onChange={(e) => setSelectedResourceToShare(e.target.value)}
                        aria-label="Select course material to share"
                        className="max-w-[200px] px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                      >
                        <option value="">Share a unit material...</option>
                        {courseMaterialsForActiveRoom.map((res) => (
                          <option key={res.id} value={res.id}>
                            {res.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={!selectedResourceToShare || sendingMessage}
                        onClick={() => {
                          const mat = courseMaterialsForActiveRoom.find(
                            (r) => r.id === selectedResourceToShare
                          );
                          if (!mat) return;
                          void handleSendRoomMessage(
                            'resource_share',
                            `Shared ${mat.resourceType}: "${mat.title}" (${mat.courseCode})${
                              mat.authorOrEdition ? ` — ${mat.authorOrEdition}` : ''
                            }`
                          );
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-amber-500/50 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 disabled:opacity-40 whitespace-nowrap"
                      >
                        <Share2 className="w-3 h-3" />
                        <span>Share</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex-1 p-4 overflow-y-auto space-y-3">
                  {roomMessages.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No messages yet. Start the discussion or share a revision topic below.
                    </p>
                  ) : (
                    roomMessages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`text-xs space-y-1 ${
                          msg.kind === 'resource_share'
                            ? 'p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10'
                            : msg.kind === 'system'
                            ? 'text-slate-500 dark:text-slate-400 italic'
                            : ''
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-slate-500 dark:text-slate-400">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {msg.senderName}
                          </span>
                          {msg.senderAdmissionNo && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono text-[11px]">{msg.senderAdmissionNo}</span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {new Date(msg.createdAt).toLocaleTimeString('en-KE', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-slate-700 dark:text-slate-200 flex items-start gap-1.5 leading-relaxed">
                          {msg.kind === 'resource_share' && (
                            <BookOpen className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          )}
                          <span>{msg.body}</span>
                        </p>
                      </div>
                    ))
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleSendRoomMessage('chat');
                  }}
                  className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
                >
                  <input
                    type="text"
                    maxLength={1500}
                    disabled={activeGroup.status !== 'active' || sendingMessage}
                    value={chatDraft}
                    onChange={(e) => setChatDraft(e.target.value)}
                    placeholder={
                      activeGroup.status === 'active'
                        ? 'Post a question, hint, or study note to the group...'
                        : 'Room is archived — chat is read-only'
                    }
                    className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={activeGroup.status !== 'active' || sendingMessage || !chatDraft.trim()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
