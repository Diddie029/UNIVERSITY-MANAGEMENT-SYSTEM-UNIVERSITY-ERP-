# Security Specification — PUST University ERP

## 1. Core Data Invariants
1. **No Self-Assigned Privileges**: A newly signed-in user may only create a `users/{uid}` document with role `applicant` or `student` (unless matched against an admin-created `role_invites` record or bootstrapped Super Admin email). Users can never self-promote to `super_admin`, `finance`, `hr`, `admissions`, `lecturer`, `hod`, `exam_officer`, or `management`.
2. **PII Isolation**: User emails, phone numbers, and National IDs in `users/{uid}/private/{docId}` are strictly readable/writable only by the owner (`uid == request.auth.uid`) or `super_admin`.
3. **Paybill/Bank Reconciliation Gate**: Students may create `payment_submissions` ONLY with `status == 'pending_verification'`, `verifiedBy == ''`, `receiptNumber == ''`, and cannot modify `student_accounts` or `receipts`. Only verified Finance Officers or Super Admins can mark a payment `verified` or `rejected` and update `student_accounts` / issue `receipts`.
4. **Marks Workflow & Published Locking**: Only Lecturers/HoDs/Exam Officers/Super Admins may create or update `exam_marks`. Once `workflowStatus == 'published'`, Lecturers cannot edit marks; only `exam_officer` or `super_admin` may amend published marks. Students can only read their own `published` marks.
5. **HR & Payroll Confidentiality**: `employees`, `payroll_runs`, and `payslips` are strictly unreadable by students or applicants. Individual employees can only read their own employee record, leave requests, and payslips; only HR Officers, Management (for payroll approval), or Super Admins can list/write payroll runs.
6. **Immutable Audit Trail**: `audit_logs` are append-only (`allow create` for verified actors with `actorUid == request.auth.uid`); `update` and `delete` are unconditionally denied (`if false`).

## 2. The "Dirty Dozen" Adversarial Payloads (All MUST Return PERMISSION_DENIED)
1. **Privilege Escalation on Signup**: `create /users/{uid}` with `{ role: 'super_admin', uid: request.auth.uid }` by non-admin.
2. **Self-Role Promotion on Update**: `update /users/{uid}` changing `{ role: 'finance' }` by the user themselves.
3. **PII Cross-Read**: `get /users/{otherUid}/private/pii` by an unrelated authenticated student.
4. **Fake Verified Payment**: `create /payment_submissions/{id}` by a student with `{ status: 'verified', receiptNumber: 'RCT-999' }`.
5. **Student Balance Tampering**: `update /student_accounts/{studentId}` setting `{ balance: 0, cleared: true }` by the student.
6. **Forged Receipt**: `create /receipts/{id}` by a student or lecturer.
7. **Grade Self-Modification**: `update /exam_marks/{id}` changing `{ examScore: 70, grade: 'A' }` by a student.
8. **Lecturer Tampering Published Results**: `update /exam_marks/{id}` when `existing().workflowStatus == 'published'` by a `lecturer`.
9. **Unauthorized Payroll Run**: `create /payroll_runs/{id}` by a `student` or `lecturer`.
10. **Payslip Cross-Read**: `get /payroll_runs/{runId}/payslips/{otherEmpPayslipId}` by another employee or student.
11. **Audit Log Deletion/Tampering**: `delete /audit_logs/{id}` or `update /audit_logs/{id}` even by Super Admin.
12. **Shadow Field / Oversized Payload**: `create /applications/{id}` with an unallowed ghost field `{ isAdmittedBypass: true }` or 10KB `id` path variable.
