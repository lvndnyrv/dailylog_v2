-- Realistic Parent Mobile Group 22 account data for Lucia Castillo.
-- Login: lucia.castillo@parent.test / password123

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
begin
  insert into public.notification_preferences (
    profile_id, daycare_id, kind, in_app, push, email
  ) values
    (v_parent, v_daycare, 'parent_attendance', true, true, false),
    (v_parent, v_daycare, 'parent_moments', true, true, false),
    (v_parent, v_daycare, 'parent_routines', true, false, false),
    (v_parent, v_daycare, 'parent_messages', true, true, false),
    (v_parent, v_daycare, 'incident_report', true, true, false),
    (v_parent, v_daycare, 'parent_announcements', true, true, false),
    (v_parent, v_daycare, 'parent_billing', true, true, false)
  on conflict (profile_id, kind) do update set
    in_app = excluded.in_app,
    push = excluded.push,
    email = excluded.email,
    updated_at = now();

  insert into public.notification_delivery_settings (
    profile_id, daycare_id, quiet_hours_enabled,
    quiet_hours_start, quiet_hours_end, email_mode
  ) values (v_parent, v_daycare, true, time '20:00', time '07:00', 'off')
  on conflict (profile_id) do update set
    quiet_hours_enabled = excluded.quiet_hours_enabled,
    quiet_hours_start = excluded.quiet_hours_start,
    quiet_hours_end = excluded.quiet_hours_end,
    email_mode = excluded.email_mode,
    updated_at = now();

  insert into public.child_invite_codes (
    id, daycare_id, child_id, code, email, relationship,
    created_by, expires_at
  ) values (
    '55000000-0000-4000-a000-000000000001',
    v_daycare,
    v_child,
    'FAMILY22',
    'carmen.castillo@family.test',
    'Grandmother',
    v_parent,
    now() + interval '14 days'
  )
  on conflict (id) do update set
    code = excluded.code,
    email = excluded.email,
    relationship = excluded.relationship,
    used_at = null,
    used_by = null,
    expires_at = excluded.expires_at;

  delete from public.parent_data_requests
  where profile_id = v_parent and status in ('requested', 'processing');
end;
$$;
