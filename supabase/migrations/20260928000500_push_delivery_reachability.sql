-- Track only operational, non-sensitive device metadata. This lets a center
-- distinguish a current app installation from an account that has never
-- registered for push, without exposing the push token itself.

alter table public.push_tokens
  add column if not exists last_seen_at timestamptz not null default now(),
  add column if not exists last_delivered_at timestamptz,
  add column if not exists device_model text,
  add column if not exists app_version text,
  add column if not exists is_physical boolean;

alter table public.push_tokens
  drop constraint if exists push_tokens_device_model_length_check;
alter table public.push_tokens
  add constraint push_tokens_device_model_length_check
  check (device_model is null or char_length(device_model) <= 100);

alter table public.push_tokens
  drop constraint if exists push_tokens_app_version_length_check;
alter table public.push_tokens
  add constraint push_tokens_app_version_length_check
  check (app_version is null or char_length(app_version) <= 40);

create index if not exists push_tokens_user_last_seen_idx
  on public.push_tokens(user_id, last_seen_at desc);

create or replace function public.get_push_delivery_reachability()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_result jsonb;
begin
  if v_daycare is null
     or not public.has_permission('reports', 'view')
     or not public.has_permission('children', 'view')
     or not public.has_permission('staff', 'view') then
    return jsonb_build_object(
      'counts', jsonb_build_object(
        'total', 0, 'pushReady', 0, 'withoutPush', 0,
        'parentsWithoutPush', 0, 'staffWithoutPush', 0
      ),
      'gaps', '[]'::jsonb
    );
  end if;

  with active_profiles as (
    select
      profile.id,
      profile.full_name,
      profile.role,
      nullif(btrim(profile.email), '') is not null as email_present,
      max(token.last_seen_at) as last_seen_at,
      max(token.last_delivered_at) as last_delivered_at,
      count(token.id) > 0 as push_ready
    from public.profiles profile
    left join public.push_tokens token on token.user_id = profile.id
    where profile.daycare_id = v_daycare
      and profile.archived_at is null
      and profile.role in ('parent', 'educator', 'admin', 'owner_admin')
    group by profile.id, profile.full_name, profile.role, profile.email
  ), summary as (
    select
      count(*) as total,
      count(*) filter (where push_ready) as push_ready,
      count(*) filter (where not push_ready) as without_push,
      count(*) filter (where not push_ready and role = 'parent') as parents_without_push,
      count(*) filter (where not push_ready and role <> 'parent') as staff_without_push
    from active_profiles
  ), gaps as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'profileId', profile.id,
      'fullName', profile.full_name,
      'role', profile.role,
      'emailPresent', profile.email_present,
      'lastSeenAt', profile.last_seen_at,
      'lastDeliveredAt', profile.last_delivered_at
    ) order by
      case when profile.role = 'parent' then 0 else 1 end,
      profile.full_name
    ), '[]'::jsonb) as rows
    from (
      select * from active_profiles where not push_ready
      order by case when role = 'parent' then 0 else 1 end, full_name
      limit 75
    ) profile
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'total', summary.total,
      'pushReady', summary.push_ready,
      'withoutPush', summary.without_push,
      'parentsWithoutPush', summary.parents_without_push,
      'staffWithoutPush', summary.staff_without_push
    ),
    'gaps', gaps.rows
  ) into v_result
  from summary cross join gaps;

  return v_result;
end;
$$;

revoke all on function public.get_push_delivery_reachability()
  from public, anon;
grant execute on function public.get_push_delivery_reachability()
  to authenticated;

