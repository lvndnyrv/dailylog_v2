-- ============================================================================
-- Group 15 notification demo state
-- Idempotent and time-relative so tray, activity filters, toast and delivery
-- preferences remain testable after every reset or shared-dev re-seed.
-- ============================================================================

insert into notification_preferences (
  profile_id, daycare_id, kind, in_app, push, email
) values
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'ratio_alert',          true, true,  false),
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'incident_report',      true, true,  true),
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'cert_expiry',          true, false, true),
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'overdue_billing',      true, false, true),
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'new_device_sign_in',   true, true,  true),
  ('00000000-0000-4000-a000-000000000001', '10000000-0000-4000-a000-000000000001', 'waitlist_enrollment',  true, false, false)
on conflict (profile_id, kind) do update set
  in_app = excluded.in_app,
  push = excluded.push,
  email = excluded.email,
  updated_at = now();

insert into notification_delivery_settings (
  profile_id, daycare_id, quiet_hours_enabled, quiet_hours_start,
  quiet_hours_end, email_mode
) values (
  '00000000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  true, time '22:00', time '06:00', 'daily_digest'
)
on conflict (profile_id) do update set
  quiet_hours_enabled = excluded.quiet_hours_enabled,
  quiet_hours_start = excluded.quiet_hours_start,
  quiet_hours_end = excluded.quiet_hours_end,
  email_mode = excluded.email_mode,
  updated_at = now();

insert into notifications (
  id, daycare_id, profile_id, kind, title, body, payload, read_at, created_at
) values
  (
    'f1500000-0000-4000-a000-000000000001',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'ratio_alert',
    'Infant just went over ratio',
    '6 children with 1 educator — licensing requires 1:3. Tara is available to cover.',
    '{"category":"alerts","source":"Rooms & ratios","href":"/rooms","action_label":"Assign floater","severity":"critical"}',
    null,
    now() - interval '2 minutes'
  ),
  (
    'f1500000-0000-4000-a000-000000000002',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'incident_report',
    '2 incident reports need sign-off',
    'Toddler · Infant — both families have already been notified.',
    '{"category":"alerts","source":"Dashboard","href":"/dashboard?review=incident","action_label":"Review","severity":"warning"}',
    null,
    now() - interval '40 minutes'
  ),
  (
    'f1500000-0000-4000-a000-000000000003',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'new_device_sign_in',
    'New sign-in on iPhone 14',
    'Toronto · If this was not you, review your devices and end the session.',
    '{"category":"sessions","source":"Security","href":"/settings#security","action_label":"Review devices","severity":"neutral"}',
    null,
    now() - interval '42 minutes'
  ),
  (
    'f1500000-0000-4000-a000-000000000004',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'waitlist_enrollment',
    'Laurent family completed their application',
    'Chloé · Preschool · requested start date Aug 1.',
    '{"category":"enrollment","source":"Enrollment","href":"/enrollment/41000000-0000-4000-a000-000000000009","action_label":"Review application","severity":"info"}',
    null,
    now() - interval '3 hours'
  ),
  (
    'f1500000-0000-4000-a000-000000000005',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'cert_expiry',
    'Maria K.''s First Aid expires in 19 days',
    'She is the only certified lead in Infant on Thursdays.',
    '{"category":"compliance","source":"Compliance","href":"/compliance","action_label":"Send reminder","severity":"warning"}',
    now() - interval '20 hours',
    now() - interval '1 day'
  ),
  (
    'f1500000-0000-4000-a000-000000000006',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'payment_received',
    'Payment received — Okafor family',
    '$520 · Autopay tuition. Their balance is now clear.',
    '{"category":"billing","source":"Billing","href":"/billing","action_label":"View","severity":"success"}',
    now() - interval '22 hours',
    now() - interval '1 day 2 hours'
  ),
  (
    'f1500000-0000-4000-a000-000000000007',
    '10000000-0000-4000-a000-000000000001',
    '00000000-0000-4000-a000-000000000001',
    'overdue_billing',
    'Three invoices are now overdue',
    '$3,032 outstanding · the oldest invoice is 21 days late.',
    '{"category":"billing","source":"Billing","href":"/billing","action_label":"Review invoices","severity":"critical"}',
    now() - interval '2 days',
    now() - interval '2 days 3 hours'
  )
on conflict (id) do update set
  kind = excluded.kind,
  title = excluded.title,
  body = excluded.body,
  payload = excluded.payload,
  read_at = excluded.read_at,
  created_at = excluded.created_at;

-- Represents the phone-push side of 15e without requiring a real device token
-- in development. It is delivery history only; no provider worker will claim it.
insert into notification_outbox (
  id, daycare_id, recipient_id, channel, kind, title, body, payload,
  status, dedupe_key, attempts, delivered_at, provider_response,
  created_at, updated_at
) values (
  'f15e0000-0000-4000-a000-000000000001',
  '10000000-0000-4000-a000-000000000001',
  '00000000-0000-4000-a000-000000000001',
  'push', 'ratio_alert', 'Infant is over ratio',
  '6 children · 1 educator. Tap to assign a floater.',
  '{"href":"/rooms","demo":true}',
  'delivered', 'group15:ratio-alert:demo', 1, now() - interval '2 minutes',
  '{"provider":"demo","ticket":"delivered"}',
  now() - interval '2 minutes', now() - interval '2 minutes'
)
on conflict (id) do update set
  title = excluded.title,
  body = excluded.body,
  payload = excluded.payload,
  status = excluded.status,
  delivered_at = excluded.delivered_at,
  provider_response = excluded.provider_response,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at;
