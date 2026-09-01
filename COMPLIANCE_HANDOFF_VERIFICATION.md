# Compliance handoff — 2026-08-31

Branch: `codex/mobile-foundations`. Changes are not committed.

## Scope and status

Continues the admin/educator integration pass after staff messaging. The admin
HTML handoff, group 12 (12a–12e), was compared with the existing compliance page.
That page previously showed only certification and incident registers.

| Design | Implemented in this pass |
| --- | --- |
| 12a overview | Expiry table, versioned center vault, staff checklist, inspection readiness checks, drill summary, header actions |
| 12b drill | Kind, center-local date/time, lead, duration, actual headcounts, server-side attendance comparison, notes, next due date, history and audited void/correction |
| 12c staff file | Checklist uses the existing educator credential/submission register; opens the staff profile for original-document review and approval |
| 12d vault upload | Private PDF/JPEG/PNG up to 10 MB; validated file signature and stored metadata; expiry monitoring; inspector inclusion; immutable previous versions |
| 12e inspection pack | Live printable register, 48-hour bearer links, explicit sharing warning, opening audit, revocation, private current-original downloads |

Additional completion work: deadlines feed dashboard attention items; the
existing five-minute notification worker materializes deduplicated in-app
reminders. Read-only/restricted admin roles receive appropriate controls or an
access explanation. Links become unavailable if the creating admin is removed
or loses the required source permissions.

## Verification completed

- `scripts/verify-compliance-handoff.mjs`: **37 live checks passed** against the
  linked development project, including real private-file upload/download,
  version replacement, internal-only exclusion, stale-version rejection,
  anonymous/educator denial, token revocation, drill validation/correction,
  audits, and authenticated HTTP rendering of Compliance, inspection pack and
  dashboard.
- `supabase/tests/admin_compliance_handoff_test.sql`: **passed**, using the
  linked query API inside a rolled-back transaction. Covers actual expiration,
  cross-center isolation, custom/read-only admin roles, private helper denial,
  creator deactivation, permission removal, reminder visibility/deduplication.
- `supabase/tests/admin_educator_staff_messaging_handoff_test.sql`: **passed**.
  Its unread baseline was made repeatable inside the rollback transaction so
  existing development conversations do not cause false failures.
- Workspace typecheck, lint, production web build and linked database schema
  lint: **passed**.
- Migrations `20260831000100` through `20260831000400`: applied.
- Edge functions `compliance-inspection-document` and `dispatch-notifications`:
  deployed. Existing dispatch schedule confirmed active every five minutes.
- **Signed-in browser acceptance completed for the checked surfaces** using
  Amara's development account: overview, upload and drill dialogs, document
  version history, voided drill history, Maria's checklist-to-renewal-review
  navigation, inspection pack, and the sharing-warning dialog. No link was
  published and no credential review or drill was saved during this browser pass.
- Blank upload/drill submissions were blocked by required-field validation;
  missing drill headcounts showed red borders. Cancel and Escape dismissed
  dialogs. Selecting the repository's non-personal favicon and then cancelling
  discarded the selection; reopening showed no file selected and the current
  vault record remained at version 6. Nothing was uploaded by this UI check.
- Screenshots checked at the default **1280 × 720** viewport and the inspection
  pack at **768 × 900**. The compact pack had no page-width overflow; compact
  drill inputs stayed inside the dialog and the form actions remained reachable
  by scrolling. The temporary viewport override was reset. No browser warning
  or error logs were captured during the pass.
- Historical ratio capture was added in migrations `20260831000500`–`00600`.
  `admin_ratio_history_ledger_test.sql` passed against the linked project:
  sequential intervals, one current interval per room, immutable authenticated
  access, tenant isolation, and authenticated/inspector-pack inclusion. The
  one-minute `dailylog-room-ratio-history` cron is active. Browser acceptance
  confirmed that the pack separates pre-activation legacy exceptions from
  continuous observed-minute totals; because activation occurred after the
  center closed, the first continuous intervals correctly wait for next open.

Test hygiene: synthetic vault originals remain clearly labelled **not official**
and their current version is internal-only. Synthetic drills are voided with an
explanation. All generated test shares were revoked. Rollback-only test changes
to roles, profiles, centers and notifications did not persist.

## Still open / deliberate boundaries

1. **Native print-preview/PDF pagination remains pending.** The signed-in screen,
   dialog, cancellation and compact-layout checks above passed. Print styles
   were inspected (navigation/actions hidden, repeated table headings and
   row-break rules), but the operating-system print preview and a produced PDF
   were not exercised. This pass is not an exhaustive accessibility audit or a
   claim of support for every phone-sized admin viewport.
2. **Ratio history now starts at ledger activation.** Migration
   `20260831000500` stores immutable state-change intervals during configured
   center hours, with trigger capture plus a one-minute sweep for time-bound
   coverage expiry. Known pre-ledger over-ratio events were retained and are
   explicitly labelled as legacy events; they are not presented as complete
   historical compliant-day coverage.
3. **Readiness is a five-check record-completeness indicator**, not a legal
   compliance score. Required credential lists and drill frequency must be
   configured to the center’s actual requirements. The UI suggests intervals
   but allows the administrator to choose the due date.
4. **Shared packs contain minimized registers.** Full medical narratives,
   incident photos, and staff originals are not anonymously shared. Admins can
   open staff originals in the authenticated staff workflow. Vault originals
   explicitly marked for inclusion are downloadable through the live share.
5. The printed pack is a register/summary, not a single merged PDF containing
   every attachment. Approved attachment bundling and inspector-specific
   document selection are sensible follow-ups.
6. The new center deadline reminders are **in-app**. Email/push delivery for
   these new kinds is not included in this pass. Existing educator credential
   renewal notification behavior is unchanged.

## Resume here

Next include native print/PDF output in final inspection-pack acceptance, then
continue the broader
educator/admin end-to-end audit. This pass does not declare the entire product
ready for real-center deployment.

The linked CLI supports `supabase db query --linked --file <test.sql>`, so
rollback-safe SQL integration tests can now run directly without Docker or the
Supabase dashboard UI. Live upload checks require the explicit test opt-in and
password environment variable described at the top of the script; credentials
must not be committed.
