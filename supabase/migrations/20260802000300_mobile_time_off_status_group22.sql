-- ==========================================================================
-- Mobile Group 22 — educator time-off decisions, re-requests and reminders
-- ==========================================================================

alter table public.staff_time_off_requests
  add column if not exists replaces_request_id uuid
    references public.staff_time_off_requests(id) on delete set null;

create index if not exists staff_time_off_replacement_idx
  on public.staff_time_off_requests (replaces_request_id)
  where replaces_request_id is not null;

create or replace function public.mobile_workdays_between(
  p_starts_on date,
  p_ends_on date
)
returns integer
language sql
immutable
strict
set search_path = public
as $$
  select count(*)::integer
    from generate_series(p_starts_on, p_ends_on, interval '1 day') as day
   where extract(isodow from day) between 1 and 5
$$;

create or replace function public.get_mobile_time_off_status()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_member public.staff_members%rowtype;
  v_year_start date := date_trunc('year', public.center_today()::timestamp)::date;
  v_year_end date := (date_trunc('year', public.center_today()::timestamp) + interval '1 year - 1 day')::date;
  v_used integer := 0;
  v_requests jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select member.*
    into v_member
    from public.staff_members member
   where member.id = public.my_staff_member_id()
     and member.profile_id = auth.uid()
     and member.status = 'active'
     and member.archived_at is null;

  if v_member.id is null then
    raise exception 'Active staff record required';
  end if;

  select coalesce(sum(public.mobile_workdays_between(
           greatest(request.starts_on, v_year_start),
           least(request.ends_on, v_year_end)
         )), 0)::integer
    into v_used
    from public.staff_time_off_requests request
   where request.staff_member_id = v_member.id
     and request.status = 'approved'
     and request.kind in ('vacation', 'sick', 'personal')
     and request.ends_on >= v_year_start
     and request.starts_on <= v_year_end;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', request.id,
             'startsOn', request.starts_on,
             'endsOn', request.ends_on,
             'days', public.mobile_workdays_between(request.starts_on, request.ends_on),
             'kind', request.kind,
             'status', request.status,
             'reason', request.reason,
             'decisionNotes', request.decision_notes,
             'reviewerId', request.reviewed_by,
             'reviewerName', reviewer.full_name,
             'reviewedAt', request.reviewed_at,
             'createdAt', request.created_at,
             'updatedAt', request.updated_at,
             'replacesRequestId', request.replaces_request_id
           )
           order by
             case request.status when 'pending' then 0 else 1 end,
             request.created_at desc
         ), '[]'::jsonb)
    into v_requests
    from public.staff_time_off_requests request
    left join public.profiles reviewer on reviewer.id = request.reviewed_by
   where request.staff_member_id = v_member.id
     and request.ends_on >= v_year_start
     and request.starts_on <= v_year_end;

  return jsonb_build_object(
    'annualDays', v_member.annual_paid_leave_days,
    'usedDays', v_used,
    'remainingDays', greatest(0, v_member.annual_paid_leave_days - v_used),
    'requests', v_requests
  );
end;
$$;

create or replace function public.withdraw_mobile_time_off_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_member_id := public.my_staff_member_id();
  if v_member_id is null then
    raise exception 'Active staff record required';
  end if;

  perform public.assert_rate_limit('mobile_time_off_withdraw', 12, 3600, p_request_id::text);

  update public.staff_time_off_requests request
     set status = 'cancelled'
   where request.id = p_request_id
     and request.staff_member_id = v_member_id
     and request.status = 'pending';

  if not found then
    raise exception 'Only your pending requests can be withdrawn';
  end if;

  return true;
end;
$$;

create or replace function public.rerequest_mobile_time_off(
  p_previous_request_id uuid,
  p_starts_on date,
  p_ends_on date,
  p_kind text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid;
  v_new_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_member_id := public.my_staff_member_id();
  if v_member_id is null then
    raise exception 'Active staff record required';
  end if;

  if not exists (
    select 1
      from public.staff_time_off_requests request
     where request.id = p_previous_request_id
       and request.staff_member_id = v_member_id
       and request.status in ('declined', 'cancelled')
  ) then
    raise exception 'Only your declined or withdrawn request can be resubmitted';
  end if;

  perform public.assert_rate_limit('mobile_time_off_rerequest', 12, 3600, p_previous_request_id::text);

  v_new_request_id := public.request_time_off(
    p_starts_on,
    p_ends_on,
    p_kind,
    p_reason
  );

  update public.staff_time_off_requests
     set replaces_request_id = p_previous_request_id
   where id = v_new_request_id
     and staff_member_id = v_member_id;

  return v_new_request_id;
end;
$$;

create or replace function public.notify_mobile_time_off_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_reviewer_name text;
  v_title text;
  v_body text;
  v_payload jsonb;
begin
  if new.status not in ('approved', 'declined')
     or new.status is not distinct from old.status then
    return new;
  end if;

  select member.profile_id
    into v_recipient
    from public.staff_members member
   where member.id = new.staff_member_id;

  if v_recipient is null then
    return new;
  end if;

  select profile.full_name
    into v_reviewer_name
    from public.profiles profile
   where profile.id = new.reviewed_by;

  v_reviewer_name := coalesce(nullif(v_reviewer_name, ''), 'Your director');
  v_title := case new.status
    when 'approved' then 'Time-off request approved'
    else 'Time-off request needs new dates'
  end;
  v_body := case new.status
    when 'approved' then format(
      '%s approved your %s request for %s to %s.',
      v_reviewer_name, new.kind, to_char(new.starts_on, 'Mon FMDD'), to_char(new.ends_on, 'Mon FMDD')
    )
    else format(
      '%s declined your %s request. Tap to read the reason and choose different dates.',
      v_reviewer_name, new.kind
    )
  end;
  v_payload := jsonb_build_object(
    'type', 'time_off_decision',
    'screen', 'TimeOffDetail',
    'requestId', new.id,
    'status', new.status,
    'channelId', 'default'
  );

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  ) values (
    new.daycare_id, v_recipient, 'push', 'time_off', v_title, v_body, v_payload,
    'time-off-decision:' || new.id::text || ':' || new.status
  ) on conflict do nothing;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  values (new.daycare_id, v_recipient, 'time_off', v_title, v_body, v_payload);

  return new;
end;
$$;

drop trigger if exists notify_mobile_time_off_decision
  on public.staff_time_off_requests;
create trigger notify_mobile_time_off_decision
  after update of status on public.staff_time_off_requests
  for each row execute function public.notify_mobile_time_off_decision();

-- Time-off decisions are staff actions, not daily-log edits. Keep the enqueue
-- permission mapping aligned so delegated directors can approve requests.
create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare v_area text;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if new.kind = 'time_off' then
    if not public.has_permission('staff', 'approve') then
      raise exception 'staff approve permission required';
    end if;
    return new;
  end if;
  v_area := case new.kind
    when 'announcement' then 'broadcasts'
    when 'incident' then 'incidents'
    when 'medication' then 'medications'
    when 'invoice' then 'billing'
    when 'payment' then 'billing'
    when 'staff_invite' then 'staff'
    when 'parent_invite' then 'children'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;

revoke all on function public.get_mobile_time_off_status() from public;
revoke all on function public.withdraw_mobile_time_off_request(uuid) from public;
revoke all on function public.rerequest_mobile_time_off(uuid, date, date, text, text) from public;
grant execute on function public.get_mobile_time_off_status() to authenticated;
grant execute on function public.withdraw_mobile_time_off_request(uuid) to authenticated;
grant execute on function public.rerequest_mobile_time_off(uuid, date, date, text, text) to authenticated;

comment on function public.get_mobile_time_off_status() is
  'Returns the signed-in educator paid-leave balance and decision-aware request history.';
comment on function public.withdraw_mobile_time_off_request(uuid) is
  'Withdraws one pending request owned by the signed-in educator.';
comment on function public.rerequest_mobile_time_off(uuid, date, date, text, text) is
  'Creates a replacement for one declined or withdrawn request owned by the signed-in educator.';

notify pgrst, 'reload schema';
