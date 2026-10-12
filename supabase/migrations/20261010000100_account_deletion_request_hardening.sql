-- Replace the shared mobile client's immediate auth-user deletion with a
-- verified, reviewable account-closure workflow. Parent requests continue to
-- use parent_data_requests; staff/admin requests live here so employment and
-- regulated childcare records are never orphaned by a client-side action.

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner_admin', 'admin', 'educator')),
  status text not null default 'requested'
    check (status in ('requested', 'processing', 'completed', 'cancelled')),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists account_deletion_requests_one_open_idx
  on public.account_deletion_requests (profile_id)
  where status in ('requested', 'processing');

create index if not exists account_deletion_requests_center_status_idx
  on public.account_deletion_requests (daycare_id, status, requested_at desc);

drop trigger if exists account_deletion_requests_updated_at
  on public.account_deletion_requests;
create trigger account_deletion_requests_updated_at
  before update on public.account_deletion_requests
  for each row execute function public.update_updated_at();

alter table public.account_deletion_requests enable row level security;

drop policy if exists "users read own account deletion requests"
  on public.account_deletion_requests;
create policy "users read own account deletion requests"
  on public.account_deletion_requests for select
  using (profile_id = auth.uid());

drop policy if exists "admins review center account deletion requests"
  on public.account_deletion_requests;
create policy "admins review center account deletion requests"
  on public.account_deletion_requests for all
  using (
    is_admin()
    and daycare_id = get_my_daycare_id()
    and profile_id <> auth.uid()
  )
  with check (
    is_admin()
    and daycare_id = get_my_daycare_id()
    and profile_id <> auth.uid()
  );

create or replace function public.request_my_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_parent_request jsonb;
  v_request public.account_deletion_requests%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and archived_at is null;

  if v_profile.id is null or v_profile.daycare_id is null then
    raise exception 'An active center-linked account is required';
  end if;

  if v_profile.role = 'parent' then
    v_parent_request := public.request_parent_data_action('deletion');
    return v_parent_request || jsonb_build_object('source', 'parent');
  end if;

  perform public.assert_rate_limit('account_deletion_request', 4, 86400, v_profile.id::text);

  select * into v_request
  from public.account_deletion_requests request
  where request.profile_id = v_profile.id
    and request.status in ('requested', 'processing')
  order by request.requested_at desc
  limit 1;

  if v_request.id is null then
    insert into public.account_deletion_requests (
      daycare_id, profile_id, role
    ) values (
      v_profile.daycare_id, v_profile.id, v_profile.role
    ) returning * into v_request;
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'source', 'account',
    'request_type', 'deletion',
    'role', v_request.role,
    'status', v_request.status,
    'requested_at', v_request.requested_at,
    'completed_at', v_request.completed_at
  );
end;
$$;

create or replace function public.transition_account_deletion_request(
  p_request_id uuid,
  p_expected_status text,
  p_next_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.profiles%rowtype;
  v_request public.account_deletion_requests%rowtype;
begin
  select * into v_admin
  from public.profiles
  where id = auth.uid()
    and role in ('owner_admin', 'admin')
    and archived_at is null;

  if v_admin.id is null or v_admin.daycare_id is null then
    raise exception 'An active administrator account is required';
  end if;

  if not (
    (p_expected_status = 'requested' and p_next_status = 'processing')
    or (p_expected_status = 'processing' and p_next_status = 'completed')
  ) then
    raise exception 'Unsupported account deletion transition';
  end if;

  update public.account_deletion_requests request
  set status = p_next_status,
      handled_by = v_admin.id,
      completed_at = case when p_next_status = 'completed' then now() else null end,
      notes = case
        when nullif(btrim(coalesce(p_notes, '')), '') is not null
          then left(btrim(p_notes), 2000)
        else request.notes
      end
  where request.id = p_request_id
    and request.daycare_id = v_admin.daycare_id
    and request.profile_id <> v_admin.id
    and request.status = p_expected_status
  returning * into v_request;

  if v_request.id is null then
    raise exception 'This request changed, belongs to you, or is not available to your center';
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'source', 'account',
    'request_type', 'deletion',
    'role', v_request.role,
    'status', v_request.status,
    'handled_by', v_request.handled_by,
    'completed_at', v_request.completed_at,
    'notes', v_request.notes,
    'updated_at', v_request.updated_at
  );
end;
$$;

create or replace function public.route_account_deletion_request_handoff()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_actor uuid := auth.uid();
begin
  select coalesce(nullif(profile.full_name, ''), profile.email, 'A team member')
  into v_name
  from public.profiles profile
  where profile.id = new.profile_id;

  if tg_op = 'INSERT' then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select
      new.daycare_id,
      admin.id,
      'parent_data_request',
      'New account closure request',
      v_name || ' requested an account closure review. Open Privacy requests in Settings.',
      jsonb_build_object(
        'type', 'account_deletion_request_admin',
        'screen', 'AdminPrivacyRequests',
        'requestId', new.id,
        'source', 'account'
      )
    from public.profiles admin
    where admin.daycare_id = new.daycare_id
      and admin.role in ('owner_admin', 'admin')
      and admin.archived_at is null
      and admin.id <> new.profile_id;

    insert into public.audit_log (
      daycare_id, actor_id, action, entity_type, entity_id, after
    ) values (
      new.daycare_id, v_actor, 'insert', 'account_deletion_requests', new.id,
      jsonb_build_object('role', new.role, 'status', new.status)
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    ) values (
      new.daycare_id,
      new.profile_id,
      'parent_data_request',
      case new.status
        when 'processing' then 'Your account closure request is being reviewed'
        when 'completed' then 'Your account closure request was handled'
        else 'Your account closure request was updated'
      end,
      case new.status
        when 'processing' then 'An administrator has started the identity, access, and record-retention review.'
        when 'completed' then 'An administrator marked the review handled. Contact your center if you still have access questions.'
        else 'Contact your center administrator for the latest status.'
      end,
      jsonb_build_object(
        'type', 'account_deletion_request',
        'screen', 'Settings',
        'requestId', new.id,
        'status', new.status
      )
    );

    insert into public.audit_log (
      daycare_id, actor_id, action, entity_type, entity_id, before, after
    ) values (
      new.daycare_id, v_actor, 'update', 'account_deletion_requests', new.id,
      jsonb_build_object('status', old.status),
      jsonb_build_object('status', new.status)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists account_deletion_requests_handoff
  on public.account_deletion_requests;
create trigger account_deletion_requests_handoff
  after insert or update of status on public.account_deletion_requests
  for each row execute function public.route_account_deletion_request_handoff();

revoke all on function public.request_my_account_deletion() from public;
revoke all on function public.transition_account_deletion_request(uuid, text, text, text) from public;
grant execute on function public.request_my_account_deletion() to authenticated;
grant execute on function public.transition_account_deletion_request(uuid, text, text, text) to authenticated;
