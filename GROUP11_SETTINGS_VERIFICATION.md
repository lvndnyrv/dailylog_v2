# Group 11 — settings verification (in progress)

Compared `design/designs/DailyLog WEB - Admin.dc.html` screens 11a–11e with the settings page and linked development database.

The center profile editor, closure creation/cancellation, late-pickup policy scheduling, security rule, and audit history are implemented. The existing Group 11 rollback test passed. The sick-return rule now has an editor; its value is used by the family absence handoff, and that linked rollback test passed. Updates now require an affected center row before reporting success.

Two design promises still need end-to-end work before Group 11 can be called complete:

- Photo consent exists as a center setting, but its effects still need end-to-end verification. The setting remains read-only until then. The new-pickup ID setting is enforced for first-time non-account pickup people in verified mobile hand-off, with a staff attestation audit; PIN kiosk and family-QR checkout direct those people to verified hand-off. Bulk classroom attendance now records arrivals only, and the unused direct check-out actions were removed. A database trigger also rejects direct insert, update, or reversal of checkout timestamps outside verified pickup, kiosk, family QR, or audited admin correction workflows. Rollback-only database tests cover those boundaries. Historical attendance corrections remain a separate, audited admin workflow.
- The mockup says audit records are retained for seven years. No matching retention lifecycle was found, so the application no longer presents that unverified guarantee. A retention policy and scheduled enforcement still need a separate decision and implementation.

The web typecheck, lint, and production build pass. Authenticated visual interaction with Settings was not performed in this pass.
