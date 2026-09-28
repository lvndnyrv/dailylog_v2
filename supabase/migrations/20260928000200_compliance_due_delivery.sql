-- Deliver center compliance deadlines through the same durable notification
-- outbox as the rest of DailyLog. The in-app record and each external channel
-- remain independently configurable per administrator.

alter table public.notification_preferences
  drop constraint if exists notification_preferences_kind_check;
alter table public.notification_preferences
  add constraint notification_preferences_kind_check check (kind in (
    'ratio_alert',
    'incident_report',
    'cert_expiry',
    'compliance_due',
    'overdue_billing',
    'new_device_sign_in',
    'waitlist_enrollment',
    'parent_attendance',
    'parent_moments',
    'parent_routines',
    'parent_messages',
    'parent_announcements',
    'parent_billing',
    'parent_schedule'
  ));

create or replace function public.enqueue_compliance_due_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center record;
  v_item record;
  v_profile record;
  v_key text;
  v_title text;
  v_body text := 'Review the record and next steps in Compliance.';
  v_payload jsonb;
  v_in_app boolean;
  v_push boolean;
  v_email boolean;
  v_created boolean;
  v_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required';
  end if;

  for v_center in select id from public.daycares loop
    for v_item in select * from public._compliance_due_items(v_center.id) loop
      for v_profile in
        select profile.id
        from public.profiles profile
        where profile.daycare_id = v_center.id
          and profile.role in ('owner_admin', 'admin')
          and profile.archived_at is null
          and public._compliance_profile_access(profile.id, v_center.id, false)
      loop
        v_key := 'compliance:' || v_item.id::text || ':' || v_item.due_on::text || ':' ||
          case
            when v_item.days_left < 0 then 'overdue'
            when v_item.days_left = 0 then 'today'
            when v_item.days_left <= 7 then '7'
            when v_item.days_left <= 30 then '30'
            else '60'
          end;
        v_title := v_item.title || case
          when v_item.days_left < 0 then ' is overdue'
          when v_item.days_left = 0 then ' is due today'
          else ' is due in ' || v_item.days_left || ' days'
        end;
        v_payload := jsonb_build_object(
          'type', 'compliance_due',
          'category', 'compliance',
          'source', 'Compliance',
          'href', '/compliance',
          'action_label', 'Review compliance',
          'severity', case when v_item.days_left < 0 then 'critical' else 'warning' end,
          'channelId', case when v_item.days_left <= 0 then 'urgent' else 'default' end,
          'priority', case when v_item.days_left <= 0 then 'high' else 'default' end,
          'dedupeKey', v_key
        );

        select
          coalesce(preference.in_app, true),
          coalesce(preference.push, true),
          coalesce(preference.email, true)
        into v_in_app, v_push, v_email
        from (select 1) defaults
        left join public.notification_preferences preference
          on preference.profile_id = v_profile.id
         and preference.kind = 'compliance_due';

        v_created := false;
        perform pg_advisory_xact_lock(hashtextextended(v_profile.id::text || v_key, 0));

        if v_in_app and not exists (
          select 1
          from public.notifications notification
          where notification.profile_id = v_profile.id
            and notification.kind = 'compliance_due'
            and notification.payload ->> 'dedupeKey' = v_key
        ) then
          insert into public.notifications (
            daycare_id, profile_id, kind, title, body, payload
          ) values (
            v_center.id, v_profile.id, 'compliance_due', v_title, v_body, v_payload
          );
          v_created := true;
        end if;

        if v_push then
          insert into public.notification_outbox (
            daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
          ) values (
            v_center.id, v_profile.id, 'push', 'compliance_due',
            v_title, v_body, v_payload, v_key
          ) on conflict do nothing;
          v_created := v_created or found;
        end if;

        if v_email then
          insert into public.notification_outbox (
            daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
          ) values (
            v_center.id, v_profile.id, 'email', 'compliance_due',
            v_title, v_body, v_payload, v_key
          ) on conflict do nothing;
          v_created := v_created or found;
        end if;

        if v_created then v_count := v_count + 1; end if;
      end loop;
    end loop;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.enqueue_compliance_due_reminders()
  from public, anon, authenticated;
grant execute on function public.enqueue_compliance_due_reminders()
  to service_role;
