-- Minimal first-party diagnostics for authenticated app failures. Reports are
-- deliberately structured: no arbitrary error messages, stacks, URLs, form
-- values, child names, or request bodies can be submitted by a client.

create table if not exists public.client_error_reports (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid references public.daycares(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  surface text not null check (surface in ('mobile_ios', 'mobile_android', 'web_admin')),
  error_code text not null check (error_code ~ '^[a-z0-9_]{3,64}$'),
  app_version text check (app_version is null or length(app_version) <= 32),
  release_channel text check (release_channel is null or length(release_channel) <= 32),
  framework_reference text check (framework_reference is null or framework_reference ~ '^[A-Za-z0-9_-]{1,80}$'),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists client_error_reports_center_created_idx
  on public.client_error_reports (daycare_id, created_at desc);

alter table public.client_error_reports enable row level security;

drop policy if exists "admins read center client error reports"
  on public.client_error_reports;
create policy "admins read center client error reports"
  on public.client_error_reports for select
  using (is_admin() and daycare_id = get_my_daycare_id());

create or replace function public.report_client_error(
  p_surface text,
  p_error_code text,
  p_app_version text default null,
  p_release_channel text default null,
  p_framework_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_id uuid;
  v_surface text := lower(btrim(coalesce(p_surface, '')));
  v_code text := lower(btrim(coalesce(p_error_code, '')));
  v_reference text := nullif(btrim(coalesce(p_framework_reference, '')), '');
begin
  select * into v_profile
  from public.profiles
  where id = auth.uid() and archived_at is null;

  if v_profile.id is null then
    raise exception 'An authenticated DailyLog profile is required';
  end if;
  if v_surface not in ('mobile_ios', 'mobile_android', 'web_admin') then
    raise exception 'Unsupported diagnostic surface';
  end if;
  if v_code !~ '^[a-z0-9_]{3,64}$' then
    raise exception 'Invalid diagnostic code';
  end if;
  if v_reference is not null and v_reference !~ '^[A-Za-z0-9_-]{1,80}$' then
    v_reference := null;
  end if;

  perform public.assert_rate_limit('client_error_report', 20, 3600, v_surface);

  insert into public.client_error_reports (
    daycare_id,
    profile_id,
    surface,
    error_code,
    app_version,
    release_channel,
    framework_reference
  ) values (
    v_profile.daycare_id,
    v_profile.id,
    v_surface,
    v_code,
    left(nullif(btrim(coalesce(p_app_version, '')), ''), 32),
    left(nullif(btrim(coalesce(p_release_channel, '')), ''), 32),
    v_reference
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on table public.client_error_reports from anon, authenticated;
grant select on table public.client_error_reports to authenticated;
revoke all on function public.report_client_error(text, text, text, text, text) from public;
grant execute on function public.report_client_error(text, text, text, text, text) to authenticated;
