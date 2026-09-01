-- ============================================================================
-- Mobile Parent Group 19 completion — center-reviewed pickup people
-- ============================================================================
-- A parent may propose a trusted pickup person, but that person must not be
-- usable at the kiosk or in a mobile pass until the center reviews the request.

alter table public.child_pickups
  add column if not exists approval_status text not null default 'approved',
  add column if not exists requested_by uuid references public.profiles(id) on delete set null,
  add column if not exists requested_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

alter table public.child_pickups
  drop constraint if exists child_pickups_approval_status_check;
alter table public.child_pickups
  add constraint child_pickups_approval_status_check
  check (approval_status in ('pending', 'approved', 'rejected'));

create index if not exists child_pickups_pending_review_idx
  on public.child_pickups (daycare_id, created_at)
  where archived_at is null and approval_status = 'pending';

-- The Group 19 screens already subscribe to these domain tables. Publish them
-- idempotently so those subscriptions reflect center review and attendance
-- changes without requiring a manual refresh.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'parent_absence_reports',
    'attendance_records',
    'child_pickups',
    'pickup_passes',
    'pickup_plans'
  ] loop
    if to_regclass('public.' || v_table) is not null
       and not exists (
         select 1
           from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public'
            and tablename = v_table
       ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

drop function if exists public.get_parent_pickup_options(uuid, boolean);
create function public.get_parent_pickup_options(
  p_child_id uuid,
  p_include_removed boolean default true
)
returns table (
  source_type text,
  source_id uuid,
  full_name text,
  relationship text,
  phone text,
  avatar_url text,
  is_primary boolean,
  is_active boolean,
  approval_status text,
  requested_at timestamptz,
  review_note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
      from public.parent_children mine
     where mine.parent_id = auth.uid()
       and mine.child_id = p_child_id
       and mine.pickup_authorized
  ) then
    raise exception 'You are not authorized to manage pickup for this child';
  end if;

  return query
    select result.source_type, result.source_id, result.full_name,
           result.relationship, result.phone, result.avatar_url,
           result.is_primary, result.is_active, result.approval_status,
           result.requested_at, result.review_note
      from (
        select
          'profile'::text as source_type,
          guardian.id as source_id,
          guardian.full_name,
          link.relationship,
          nullif(guardian.phone, '') as phone,
          guardian.avatar_url,
          link.is_primary,
          link.pickup_authorized and guardian.archived_at is null as is_active,
          case
            when link.pickup_authorized and guardian.archived_at is null then 'approved'
            else 'rejected'
          end::text as approval_status,
          link.created_at as requested_at,
          null::text as review_note
        from public.parent_children link
        join public.profiles guardian on guardian.id = link.parent_id
        where link.child_id = p_child_id

        union all

        select
          'pickup'::text,
          pickup.id,
          pickup.full_name,
          pickup.relationship,
          pickup.phone,
          null::text,
          pickup.is_primary,
          pickup.archived_at is null and pickup.approval_status = 'approved',
          pickup.approval_status,
          coalesce(pickup.requested_at, pickup.created_at),
          pickup.review_note
        from public.child_pickups pickup
        where pickup.child_id = p_child_id
          and (p_include_removed or (
            pickup.archived_at is null and pickup.approval_status = 'approved'
          ))
          and not exists (
            select 1
              from public.parent_children linked
              join public.profiles linked_profile on linked_profile.id = linked.parent_id
             where linked.child_id = pickup.child_id
               and lower(btrim(linked_profile.full_name)) = lower(btrim(pickup.full_name))
          )
      ) result
     order by
       result.is_active desc,
       (result.approval_status = 'pending') desc,
       result.is_primary desc,
       result.full_name;
end;
$$;

create or replace function public.parent_add_authorized_pickup(
  p_child_id uuid,
  p_full_name text,
  p_relationship text,
  p_phone text default null
)
returns table (
  id uuid,
  full_name text,
  relationship text,
  phone text,
  is_primary boolean,
  is_active boolean
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_daycare_id uuid;
  v_child_name text;
  v_pin text;
  v_row public.child_pickups%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.parent_children mine
     where mine.parent_id = auth.uid()
       and mine.child_id = p_child_id
       and mine.pickup_authorized
  ) then
    raise exception 'You are not authorized to manage pickup for this child';
  end if;
  if nullif(btrim(p_full_name), '') is null or length(btrim(p_full_name)) > 120 then
    raise exception 'A valid full name is required';
  end if;
  if nullif(btrim(p_relationship), '') is null or length(btrim(p_relationship)) > 80 then
    raise exception 'A relationship is required';
  end if;
  if length(coalesce(btrim(p_phone), '')) > 40 then
    raise exception 'Phone number is too long';
  end if;

  select child.daycare_id, child.first_name || ' ' || child.last_name
    into v_daycare_id, v_child_name
    from public.children child
   where child.id = p_child_id and child.archived_at is null;
  if v_daycare_id is null then raise exception 'Child not found'; end if;

  perform public.assert_rate_limit('parent_add_pickup', 10, 3600, p_child_id::text);
  perform pg_advisory_xact_lock(hashtext(v_daycare_id::text), 19019);

  if exists (
    select 1
      from public.child_pickups existing
     where existing.child_id = p_child_id
       and existing.archived_at is null
       and existing.approval_status in ('pending', 'approved')
       and lower(btrim(existing.full_name)) = lower(btrim(p_full_name))
  ) then
    raise exception 'This person is already listed for this child';
  end if;

  perform set_config('dailylog.parent_pickup_rpc', 'allowed', true);
  loop
    v_pin := lpad(floor(random() * 10000)::integer::text, 4, '0');
    exit when not exists (
      select 1 from public.child_pickups existing
       where existing.daycare_id = v_daycare_id
         and existing.pin = v_pin
         and existing.archived_at is null
    );
  end loop;

  insert into public.child_pickups (
    daycare_id, child_id, full_name, relationship, phone, pin, created_by,
    approval_status, requested_by, requested_at
  ) values (
    v_daycare_id, p_child_id, btrim(p_full_name), btrim(p_relationship),
    nullif(btrim(p_phone), ''), v_pin, auth.uid(),
    'pending', auth.uid(), now()
  ) returning * into v_row;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select v_daycare_id, admin.id, 'pickup_review',
         'Pickup person needs review',
         v_row.full_name || ' was added for ' || v_child_name || '.',
         jsonb_build_object(
           'type', 'pickup_review', 'screen', 'ChildProfile',
           'childId', p_child_id, 'pickupId', v_row.id
         )
    from public.profiles admin
   where admin.daycare_id = v_daycare_id
     and admin.role in ('owner_admin', 'admin')
     and admin.archived_at is null;

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  )
  select v_daycare_id, admin.id, 'push', 'pickup_review',
         'Pickup person needs review',
         v_row.full_name || ' was added for ' || v_child_name || '.',
         jsonb_build_object(
           'type', 'pickup_review', 'screen', 'ChildProfile',
           'childId', p_child_id, 'pickupId', v_row.id
         ),
         'pickup-review:' || v_row.id
    from public.profiles admin
   where admin.daycare_id = v_daycare_id
     and admin.role in ('owner_admin', 'admin')
     and admin.archived_at is null
  on conflict do nothing;

  return query select v_row.id, v_row.full_name, v_row.relationship,
    v_row.phone, v_row.is_primary, false;
end;
$$;

create or replace function public.review_parent_authorized_pickup(
  p_pickup_id uuid,
  p_decision text,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pickup public.child_pickups%rowtype;
  v_status text := lower(btrim(coalesce(p_decision, '')));
  v_child_name text;
begin
  if auth.uid() is null or not public.has_permission('children', 'edit') then
    raise exception 'Children edit permission required';
  end if;
  if v_status not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected';
  end if;
  if length(coalesce(btrim(p_note), '')) > 500 then
    raise exception 'Review note is too long';
  end if;

  select * into v_pickup
    from public.child_pickups
   where id = p_pickup_id
   for update;
  if v_pickup.id is null
     or v_pickup.daycare_id <> public.get_my_daycare_id()
     or not public.can_write_child(v_pickup.child_id) then
    raise exception 'Pickup request not found';
  end if;
  if v_pickup.archived_at is not null then
    raise exception 'A removed pickup person cannot be reviewed';
  end if;
  if v_pickup.approval_status <> 'pending' then
    if v_pickup.approval_status = v_status then return v_status; end if;
    raise exception 'This pickup request has already been reviewed';
  end if;

  update public.child_pickups
     set approval_status = v_status,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = nullif(btrim(p_note), '')
   where id = p_pickup_id;

  if v_status = 'rejected' then
    update public.pickup_passes
       set revoked_at = now()
     where pickup_id = p_pickup_id
       and used_at is null and revoked_at is null;
    update public.pickup_plans
       set status = 'cancelled'
     where pickup_id = p_pickup_id and status = 'expected';
  end if;

  select child.first_name || ' ' || child.last_name into v_child_name
    from public.children child where child.id = v_pickup.child_id;

  if v_pickup.requested_by is not null then
    insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
    values (
      v_pickup.daycare_id, v_pickup.requested_by, 'pickup_reviewed',
      case when v_status = 'approved'
        then v_pickup.full_name || ' is approved for pickup'
        else v_pickup.full_name || ' was not approved for pickup'
      end,
      case when v_status = 'approved'
        then v_pickup.full_name || ' can now pick up ' || v_child_name || '.'
        else coalesce(nullif(btrim(p_note), ''), 'Contact the center if you have questions.')
      end,
      jsonb_build_object(
        'type', 'pickup_reviewed', 'screen', 'AuthorizedPickups',
        'childId', v_pickup.child_id, 'pickupId', v_pickup.id,
        'status', v_status
      )
    );

    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    ) values (
      v_pickup.daycare_id, v_pickup.requested_by, 'push', 'pickup_reviewed',
      case when v_status = 'approved'
        then v_pickup.full_name || ' is approved for pickup'
        else v_pickup.full_name || ' was not approved for pickup'
      end,
      case when v_status = 'approved'
        then v_pickup.full_name || ' can now pick up ' || v_child_name || '.'
        else coalesce(nullif(btrim(p_note), ''), 'Contact the center if you have questions.')
      end,
      jsonb_build_object(
        'type', 'pickup_reviewed', 'screen', 'AuthorizedPickups',
        'childId', v_pickup.child_id, 'pickupId', v_pickup.id,
        'status', v_status
      ),
      'pickup-reviewed:' || v_pickup.id || ':' || v_status
    ) on conflict do nothing;
  end if;

  return v_status;
end;
$$;

-- Guard every current and future caller, not only the mobile RPC. Pending or
-- rejected pickup people cannot back a QR pass or a scheduled pickup plan.
create or replace function public.enforce_approved_pickup_credential()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pickup_id is not null and not exists (
    select 1
      from public.child_pickups pickup
     where pickup.id = new.pickup_id
       and pickup.child_id = new.child_id
       and pickup.archived_at is null
       and pickup.approval_status = 'approved'
  ) then
    raise exception 'This pickup person is still awaiting center approval';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_pickup_pass_approval on public.pickup_passes;
create trigger enforce_pickup_pass_approval
  before insert or update of pickup_id, child_id on public.pickup_passes
  for each row execute function public.enforce_approved_pickup_credential();

drop trigger if exists enforce_pickup_plan_approval on public.pickup_plans;
create trigger enforce_pickup_plan_approval
  before insert or update of pickup_id, child_id on public.pickup_plans
  for each row execute function public.enforce_approved_pickup_credential();

-- Legacy four-digit kiosk credentials follow the same approval gate.
create or replace function public.kiosk_lookup_pin(p_pin text)
returns table (
  pickup_name text, child_id uuid, first_name text, last_name text,
  room_name text, checked_in_at timestamptz, checked_out_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.has_permission('attendance', 'edit') then raise exception 'Attendance permission required'; end if;
  perform public.assert_rate_limit('kiosk_pin_lookup', 30, 60, public.get_my_daycare_id()::text);
  return query
    select cp.full_name, c.id, c.first_name, c.last_name, cl.name,
           ar.checked_in_at, ar.checked_out_at
      from public.child_pickups cp
      join public.children c on c.id = cp.child_id and c.archived_at is null
      left join public.classrooms cl on cl.id = c.classroom_id
      left join public.attendance_records ar on ar.child_id = c.id and ar.date = public.center_today()
     where cp.pin = btrim(p_pin)
       and cp.archived_at is null
       and cp.approval_status = 'approved'
       and cp.daycare_id = public.get_my_daycare_id();
end;
$$;

create or replace function public.kiosk_check(p_child_id uuid, p_pin text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_pickup public.child_pickups%rowtype;
  v_record public.attendance_records%rowtype;
  v_today date := public.center_today();
begin
  if not public.has_permission('attendance', 'edit') then raise exception 'Attendance permission required'; end if;
  perform public.assert_rate_limit('kiosk_pin_redeem', 30, 60, public.get_my_daycare_id()::text);

  select * into v_pickup from public.child_pickups
   where pin = btrim(p_pin)
     and child_id = p_child_id
     and archived_at is null
     and approval_status = 'approved'
     and daycare_id = public.get_my_daycare_id();
  if v_pickup.id is null then raise exception 'PIN does not match an approved pickup for this child'; end if;

  select * into v_record from public.attendance_records
   where child_id = p_child_id and date = v_today;
  if v_record.id is null or v_record.checked_in_at is null then
    insert into public.attendance_records (
      daycare_id, child_id, date, checked_in_at, method, status, dropped_off_by
    ) values (
      v_pickup.daycare_id, p_child_id, v_today, now(), 'kiosk', 'present', v_pickup.full_name
    ) on conflict (child_id, date) do update
      set checked_in_at = now(), method = 'kiosk', status = 'present',
          dropped_off_by = v_pickup.full_name, checked_out_at = null, checked_out_by = null;
    return 'checked_in';
  end if;
  if v_record.checked_out_at is null then
    update public.attendance_records set checked_out_at = now(), picked_up_by = v_pickup.full_name,
      method = 'kiosk' where id = v_record.id;
    return 'checked_out';
  end if;
  update public.attendance_records set checked_in_at = now(), checked_out_at = null,
    dropped_off_by = v_pickup.full_name, method = 'kiosk' where id = v_record.id;
  return 'checked_in';
end;
$$;

revoke all on function public.get_parent_pickup_options(uuid, boolean) from public, anon;
revoke all on function public.parent_add_authorized_pickup(uuid, text, text, text) from public, anon;
revoke all on function public.review_parent_authorized_pickup(uuid, text, text) from public, anon;
grant execute on function public.get_parent_pickup_options(uuid, boolean) to authenticated;
grant execute on function public.parent_add_authorized_pickup(uuid, text, text, text) to authenticated;
grant execute on function public.review_parent_authorized_pickup(uuid, text, text) to authenticated;
