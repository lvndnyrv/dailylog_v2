# Group 15 — notification center follow-up

Checked against `design/designs/DailyLog WEB - Admin.dc.html` screens 15a–15e on 2026-10-18.

## Fixed in this pass

- Read state changes only after the server confirms the action. A failed mark-read or mark-all-read leaves the alert visibly unread and shows an error.
- The activity sidebar lists categories as muted only when all three delivery channels are off. It no longer invents muted categories or claims push is active on this particular phone merely because push is enabled in preferences.
- Required in-app channels for ratio, incident, and new-device alerts are visibly locked, matching the database rule.
- The activity view stacks its main column and sidebar on narrower widths.
- Quiet hours now apply at the server-side outbox claim boundary in the center's timezone. Ordinary pushes remain pending until the next worker run outside quiet hours; ratio and incident pushes and email remain eligible.
- The new-device alert opens the real Devices & active sessions dialog. Closing it returns to Settings and restores focus to the account button.
- The activity list now loads older records in 50-item pages using a stable timestamp/ID cursor; filtering can continue past the original 100-record boundary.
- Non-urgent administrator email (`cert_expiry`, `compliance_due`, `overdue_billing`, `waitlist_enrollment`) is now assembled into one digest per recipient and center-local day after 8 AM the following day. Urgent and operational email remains individual. Source rows are held until the digest succeeds or permanently fails; retries use the digest's stable outbox ID.
- The delivery sidebar distinguishes the digest from immediate urgent email rather than describing every selected category as one delivery mode.
- The seeded owner's delivery-health panel showed 121 failed deliveries in seven days, each sampled failure reporting that the email provider is not configured. The panel now calls this an app-level setup gap and no longer describes an email address on file as a working fallback.

## Verification

- `20261018000100_notification_quiet_hours_claim_guard.sql` deployed to the linked development project.
- `notification_quiet_hours_group15_test.sql` passed as a rollback-only database test for held push, exempt safety push, unaffected email, and delivery after quiet hours are disabled.
- `20261018000200_admin_notification_email_digests.sql` and the updated `dispatch-notifications` worker deployed to the linked development project. `admin_notification_digest_group15_test.sql` passed as a rollback-only check for same-day grouping, held sources, immediate safety email, success/failure propagation, and retry re-holding.
- The linked project's `dispatch-notifications-every-5-min` cron job is active, so due digests have a recurring worker run after the 8 AM center-local boundary.
- Authenticated browser: notification center and settings modal loaded, required controls were disabled, and the sessions deep link opened and closed with focus return.
- Authenticated browser after the follow-up: the activity page rendered with the corrected email status and no runtime error. The seeded owner has fewer than 100 activity rows, so a live second-page click still needs a larger test fixture.
- Web typecheck, targeted ESLint, production build, and `git diff --check` passed.

## Remaining Group 15 checks

- A real device push and external email delivery round trip were not triggered; the database test verifies queue eligibility only.
- Verify the older-activity cursor with an account that has more than 100 notifications, including same-timestamp records.
- External email still cannot be exercised until an email provider is configured; the linked development project currently reports `EMAIL_WEBHOOK_URL` missing. Verify provider acceptance, idempotency, and recipient rendering when one is connected.
