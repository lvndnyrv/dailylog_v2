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
  "idempotencyKey": "outbox-row-uuid"
}
```

The email adapter should treat `idempotencyKey` as unique and return a 2xx
status only after the provider accepts the message.

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

The command intentionally fails until the mobile app is upgraded incrementally
from Expo SDK 54 through SDK 55 to SDK 56 and the real EAS project ID, unique
bundle IDs, store URLs, App Store Connect IDs, Google service account file, and
a dedicated monochrome notification icon are supplied. Expo recommends
one-SDK-at-a-time upgrades; that native dependency migration should be reviewed
and device-tested separately from these backend foundations. Deployment values
are not invented or committed by the P0 implementation.
