-- Public, read-only mobile compatibility configuration. This endpoint is
-- intentionally available before sign-in so unsupported clients are stopped
-- before they enter authentication or registration flows.
insert into public.app_config (key, value, updated_at)
values
  ('min_app_version', to_jsonb('1.0.0'::text), now()),
  ('recommended_app_version', to_jsonb('1.0.0'::text), now())
on conflict (key) do nothing;

create or replace function public.get_mobile_release_config()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'minimumVersion', coalesce(
      (select value #>> '{}' from public.app_config where key = 'min_app_version'),
      '1.0.0'
    ),
    'recommendedVersion', coalesce(
      (select value #>> '{}' from public.app_config where key = 'recommended_app_version'),
      '1.0.0'
    )
  );
$$;

revoke all on function public.get_mobile_release_config() from public;
grant execute on function public.get_mobile_release_config() to anon, authenticated;

comment on function public.get_mobile_release_config() is
  'Returns only non-sensitive mobile version compatibility values before or after sign-in.';
