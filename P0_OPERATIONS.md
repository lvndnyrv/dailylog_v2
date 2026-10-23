# P0 operations handoff

The P0 migrations are intentionally provider-neutral. Applying the database
migrations activates households, the notification outbox, staff timekeeping,
the family ledger, dynamic RBAC, and public RPC rate limits.

## Database verification

Run against an isolated database before promoting the migrations:

```sh
supabase db reset
/opt/homebrew/opt/libpq/bin/psql "$DATABASE_URL" -f supabase/tests/rls_smoke_test.sql
```

The smoke test runs in a transaction and rolls back its fixtures. It verifies
household isolation, the role matrix, ledger entries, notification enqueue,
clock-in/out, token-RPC revocation, and anonymous inquiry throttling.

## Notification worker

Set the secrets named in `supabase/functions/.env.example`, then deploy:

```sh
supabase functions deploy dispatch-notifications --no-verify-jwt
```

Invoke `dispatch-notifications` every five minutes from Supabase Cron or another
scheduler. Send `x-worker-secret: <NOTIFICATION_WORKER_SECRET>` on every POST.
The worker safely supports concurrent invocations and reclaims five-minute-old
leases after a crash.

For Supabase Cron, keep the header value out of `cron.job`: install `pg_cron`
and `pg_net`, save the same random worker secret in both Edge Function Secrets
as `NOTIFICATION_WORKER_SECRET` and Vault as `notification_worker_secret`, then
schedule this SQL snippet with `*/5 * * * *`:

```sql
select net.http_post(
  url := 'https://<PROJECT_REF>.supabase.co/functions/v1/dispatch-notifications',
  headers := jsonb_build_object(
    'content-type', 'application/json',
    'x-worker-secret', (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'notification_worker_secret'
      limit 1
    )
  ),
  body := '{}'::jsonb,
  timeout_milliseconds := 30000
);
```

Deploy with legacy JWT verification disabled. The function performs its own
constant-value header check, while Vault decrypts the scheduler secret only
when the job runs.

Push delivery uses Expo. Email delivery calls `EMAIL_WEBHOOK_URL` with:

```json
{
  "to": "parent@example.com",
  "recipientName": "Parent Name",
  "subject": "Notification title",
  "text": "Notification body",
  "data": {},
  "idempotencyKey": "outbox-row-uuid",
  "attachments": [
    {
      "filename": "attendance-2026-09-01-to-2026-09-30.pdf",
      "contentType": "application/pdf",
      "contentBase64": "base64-encoded-file-bytes"
    }
  ]
}
```

The email adapter should treat `idempotencyKey` as unique and return a 2xx
status only after the provider accepts the message and every supplied attachment.
`attachments` is omitted for ordinary notifications and scheduled reminders
when file delivery is not configured. The adapter must not silently ignore it.

For administrator accounts, non-urgent email selected in Notification settings
is grouped into a center-local daily digest after 8 AM on the following day.
The notification worker materializes the digest before claiming deliveries;
source rows remain linked and held until the digest succeeds or permanently
fails. Ratio, incident, new-device security, and operational email bypass the
digest. The worker must keep running after 8 AM for the digest to be sent.
The adapter's idempotency key is the digest outbox ID, which also protects
retries after a worker timeout.

Scheduled report emails can include a direct sign-in-protected report link when
the Edge Function secret `WEB_APP_URL` is set to the canonical HTTPS web origin
(for example, `https://app.example.com`). The dispatcher constructs the report
path from validated report kind and dates; it does not trust a URL in the outbox
payload. Without `WEB_APP_URL`, the email tells the recipient to open Reports
in DailyLog. `WEB_APP_URL` does not configure email delivery by itself;
`EMAIL_WEBHOOK_URL` is still required. To generate and attach the selected
scheduled PDF/CSV files, also configure:

- `REPORT_DELIVERY_URL` on the notification Edge Function, set to the canonical
  HTTPS web origin plus `/internal/report-delivery`.
- The same private, random 32+-character `REPORT_DELIVERY_SECRET` on the Edge
  Function and the web server. Never use a `NEXT_PUBLIC_` prefix for it.
- `SUPABASE_SERVICE_ROLE_KEY` on the web server only; never expose it to a client.

The internal endpoint accepts only a claimed scheduled-report outbox ID and a
matching secret. It verifies the schedule, center, and active administrator,
then archives exact PDF/CSV bytes in the private report bucket. The worker
passes up to 10 MB of total attachments to the email adapter. Larger files
remain available through the sign-in-protected Reports archive link in the
email when `WEB_APP_URL` is set. Do not enable `REPORT_DELIVERY_URL` until the
web deployment and email adapter both support this contract. Without it,
existing scheduled emails continue as reminders with a report link only.

## Report archive retention check

Report export records have an enforced minimum seven-year retention date and
cannot be changed or deleted through application-level database writes. The
date is for policy review; there is no automatic purge. After deployments and
periodically during operations, run the service-role-only query
`select * from public.report_archive_retention_health();`. Investigate any
nonzero `missing_storage_metadata` or `size_mismatches` result. This check
compares Storage metadata, not the underlying file bytes; download-time
SHA-256 verification provides a separate integrity check when a file is opened.
To sweep every saved file, run `pnpm --filter @dailylog/web verify:report-archive`
with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the process environment.
It downloads files into memory, verifies their paths, byte counts, and SHA-256
digests, and exits nonzero on any mismatch. Run it as a monitored job and
investigate failures; a successful check proves present readability, not
future durability.
Do not change the `storage` schema directly or treat this as provider-enforced
immutable storage. Legal holds, backups, and post-retention disposal still need
an approved policy and verification.

Until an email provider is configured, push and in-app delivery remain active.
Queued email rows are marked failed once with a clear `EMAIL_WEBHOOK_URL` error;
they are not reported as delivered and are not retried forever.

## Time tracking rollout

Scheduling and clock-ins are available immediately, but room ratios keep using
assigned educators until a center sets `daycares.time_tracking_enabled = true`.
Enable it only after staff have been trained to clock in and out; once enabled,
open time entries become the live educator count.

## Mobile release gate

Run:

```sh
pnpm validate:mobile-release
```

The app is on Expo SDK 57. The release gate checks Expo's recommended package
versions as well as app and store configuration; run
`pnpm check:mobile-dependencies` separately when diagnosing version drift.
It currently remains blocked by the iOS store URL, App Store Connect account
and app/team IDs, Android submission service-account file, public support email
for both apps, and the canonical HTTPS web app URL. Supply the real deployment
values and complete store/device testing before shipping; do not invent these
values or treat a successful JavaScript bundle as a store-ready native build.
