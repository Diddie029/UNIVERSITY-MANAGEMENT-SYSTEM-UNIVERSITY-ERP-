import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { Student, StudentNotification } from '../types/erp';

export function filterNotificationsForStudent(
  notifications: StudentNotification[],
  student: Student | undefined,
  uid: string | undefined,
  registeredCourseIds: Set<string>
): StudentNotification[] {
  return notifications
    .filter((n) => {
      if (n.targetScope === 'student') {
        if (student && n.targetStudentId === student.id) return true;
        if (uid && n.targetStudentUid === uid) return true;
        return false;
      }
      // Course-wide notification: show for student's registered courses, or all if none registered yet
      if (registeredCourseIds.size > 0) {
        return registeredCourseIds.has(n.courseId);
      }
      return true;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function isNotificationRead(notif: StudentNotification, readIds: Set<string>): boolean {
  if (notif.targetScope === 'student') {
    return Boolean(notif.isRead) || readIds.has(notif.id);
  }
  return readIds.has(notif.id);
}

export async function markStudentNotificationRead(
  notif: StudentNotification,
  uid: string,
  canUpdateStudentDocDirectly: boolean
): Promise<void> {
  const now = new Date().toISOString();
  try {
    if (notif.targetScope === 'student' && canUpdateStudentDocDirectly) {
      await updateDoc(doc(db, 'student_notifications', notif.id), {
        isRead: true,
        updatedAt: now,
      });
    } else {
      await setDoc(doc(db, 'users', uid, 'notification_reads', notif.id), {
        uid,
        notifId: notif.id,
        readAt: now,
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `student_notifications/${notif.id}`);
  }
}

export async function markAllStudentNotificationsRead(
  notifications: StudentNotification[],
  readIds: Set<string>,
  uid: string,
  canUpdateStudentDocDirectly: boolean
): Promise<void> {
  const unread = notifications.filter((n) => !isNotificationRead(n, readIds));
  await Promise.all(
    unread.map((n) => markStudentNotificationRead(n, uid, canUpdateStudentDocDirectly))
  );
}
