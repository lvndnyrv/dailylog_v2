# Group 10 — admin entry and account security verification

Checked against `design/designs/DailyLog WEB - Admin.dc.html`, screens 10a–10e.

| Design | Implemented surface | Verification |
| --- | --- | --- |
| 10a sign-in | Work email/password, optional one-time email link, remember-device choice, safe return destination | Public browser inspection, lint, typecheck, production build |
| 10b two-step | Authenticator-app enrollment, challenge and account management; required for newly created centers | Existing MFA flow review; new-center policy checked in rollback SQL test |
| 10c password reset | Email request, recovery link, new password, recovery-session sign-out | Code-path review and production build; live email delivery not exercised |
| 10d staff invite | Code-bound email, account creation or existing-account acceptance, email-confirmation return to invite | Linked invite lifecycle rollback SQL test; code-path review |
| 10e start center | Platform-issued email-bound registration code, email confirmation and resumable center setup | Linked center-registration guard rollback SQL test; public browser inspection |

The design illustrates SMS two-step, but this implementation uses an authenticator app (TOTP). It does not claim SMS delivery or phone verification. Existing centers retain their current MFA setting; only newly created centers default to requiring it, avoiding an unexpected lockout for current administrators.

## Corrections in this pass

- The unchecked “Keep me signed in” option now writes session-only auth cookies, including after client-side refresh. Signing out clears that preference.
- A password recovery session ends after a successful password change, so the next sign-in uses the new password.
- An invited person returning after email confirmation can accept with the confirmed account; the form no longer asks for a password it would ignore. Invite identity comes from the server-validated code rather than an editable form value.
- Center setup can be resumed after confirmation or a failed attempt without creating another account. Confirmation links return to the relevant flow.
- Redirect destinations are restricted to local paths. New admin sessions and password changes are recorded in the center audit log without recording secrets.

The linked development migration and rollback tests passed. A full email-link round trip, authenticator challenge on a real admin account, and browser-close behavior still require live manual acceptance with test accounts; they were not represented as completed by these checks.
