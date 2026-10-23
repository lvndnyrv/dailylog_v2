# Group 9 — admin dashboard verification

Checked against `design/designs/DailyLog WEB - Admin.dc.html`, screens 9a–9f.

| Design | Implemented surface | Verification |
| --- | --- | --- |
| 9a dashboard | Today's counts, attention queue, room/staffing and billing snapshots, linked actions | Production build; linked database room-nudge test |
| 9b incident sign-off | Admin review/sign-off with parent-facing incident handoff | Linked educator/admin incident handoff test |
| 9c payment reminders | Overdue invoice review, selectable recipients, delivery/audit history | New rollback test: autopay, not-yet-due, duplicate send, and parent role boundary |
| 9d global search | Search children, staff, families and invoices, plus contextual actions | Code-path and production-build review; stale results clear as a new term is typed |
| 9e quiet-room nudge | Admin nudge/expected-activity decision and educator one-tap response | Linked room-nudge recipient-boundary test |
| 9f credential reminder | Immediate reminder and scheduled follow-up | Linked deduplication test; new rollback test confirms verified renewal cancels pending follow-up |

## Group 9c/9f corrections

The dashboard and billing page now get reminder eligibility from the database. The send operation rechecks it atomically: the invoice must be overdue in the center's date, unpaid, have a valid bill-to email, and belong to a family without autopay. Only successfully queued mail creates a reminder-history row, and a same-day repeat is deduplicated. A verified credential renewal cancels its pending five-day follow-up while retaining delivery history.

All SQL tests use `BEGIN`/`ROLLBACK` against the linked development database. The web production build and focused lint pass. The browser was at sign-in during this pass, so authenticated visual interaction was not reverified. Physical delivery to an email inbox was not part of these rollback tests.
