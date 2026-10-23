-- Group 6: provider details for future annual tuition statements. This table
-- is intentionally separate from daycares, which families may read through
-- RLS. No annual statement is generated or published by this migration.
create table public.billing_tax_profiles (
  daycare_id uuid primary key references public.daycares(id) on delete cascade,
  legal_name text not null default '',
  statement_address text not null default '',
  registration_label text not null default '',
  registration_number text,
  license_number text not null default '',
  signer_name text not null default '',
  signer_title text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_tax_profiles_lengths check (
    char_length(legal_name) <= 200
    and char_length(statement_address) <= 500
    and char_length(registration_label) <= 80
    and char_length(coalesce(registration_number, '')) <= 100
    and char_length(license_number) <= 100
    and char_length(signer_name) <= 150
    and char_length(signer_title) <= 100
  )
);

create trigger billing_tax_profiles_updated_at
  before update on public.billing_tax_profiles
  for each row execute function public.update_updated_at();

alter table public.billing_tax_profiles enable row level security;
revoke all on public.billing_tax_profiles from anon, authenticated;
grant select, insert, update on public.billing_tax_profiles to authenticated;

create policy "billing admins read own tax profile"
  on public.billing_tax_profiles for select to authenticated
  using (
    public.is_admin()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  );
create policy "billing admins create own tax profile"
  on public.billing_tax_profiles for insert to authenticated
  with check (
    public.is_admin()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  );
create policy "billing admins update own tax profile"
  on public.billing_tax_profiles for update to authenticated
  using (
    public.is_admin()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  )
  with check (
    public.is_admin()
    and public.has_permission('billing', 'edit')
    and daycare_id = public.get_my_daycare_id()
  );

-- Audit presence and non-sensitive provider details, never the identifier.
create or replace function public.audit_billing_tax_profile()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    new.daycare_id,
    auth.uid(),
    lower(tg_op),
    'billing_tax_profiles',
    new.daycare_id,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'legal_name', old.legal_name,
      'statement_address', old.statement_address,
      'registration_label', old.registration_label,
      'registration_number_saved', old.registration_number is not null,
      'license_number', old.license_number,
      'signer_name', old.signer_name,
      'signer_title', old.signer_title
    ) else null end,
    jsonb_build_object(
      'legal_name', new.legal_name,
      'statement_address', new.statement_address,
      'registration_label', new.registration_label,
      'registration_number_saved', new.registration_number is not null,
      'license_number', new.license_number,
      'signer_name', new.signer_name,
      'signer_title', new.signer_title
    )
  );
  return new;
end;
$$;

revoke execute on function public.audit_billing_tax_profile() from public, anon, authenticated;
create trigger billing_tax_profiles_audit
  after insert or update on public.billing_tax_profiles
  for each row execute function public.audit_billing_tax_profile();
