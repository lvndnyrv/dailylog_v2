-- ============================================================================
-- DailyLog — guarded center registration
-- ============================================================================
-- Platform operators issue one-time, email-bound codes to approved daycare
-- administrators. The mobile client may preview a code before signup, but the
-- code is authoritatively locked and consumed only by complete_center_setup.

create table center_registration_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash bytea not null unique,
  code_suffix text not null,
  center_name text not null,
  admin_email text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_by uuid references profiles(id) on delete set null,
  daycare_id uuid references daycares(id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(btrim(center_name)) between 2 and 160),
  check (
    lower(btrim(admin_email))
      ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  check (consumed_at is null or consumed_by is not null),
  check (consumed_at is null or daycare_id is not null)
);

create index center_registration_codes_admin_idx
  on center_registration_codes (lower(admin_email), created_at desc);
create index center_registration_codes_active_idx
  on center_registration_codes (expires_at)
  where consumed_at is null and revoked_at is null;

alter table center_registration_codes enable row level security;
-- No table policies: codes are managed by platform operators and inspected
-- through narrow security-definer functions only.

create or replace function _center_registration_code_hash(p_code text)
returns bytea
language sql
immutable
strict
set search_path = public, extensions
as $$
  select digest(
    upper(regexp_replace(btrim(p_code), '[^a-zA-Z0-9]', '', 'g')),
    'sha256'
  )
$$;

revoke all on function _center_registration_code_hash(text)
  from public, anon, authenticated;

-- Operations-only helper. The plaintext code is returned once and never
-- stored; operators deliver it to the approved administrator out-of-band.
create or replace function issue_center_registration_code(
  p_center_name text,
  p_admin_email text,
  p_expires_at timestamptz default now() + interval '30 days'
)
returns table (
  registration_code text,
  center_name text,
  admin_email text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_code text;
  v_compact text;
  v_center_name text := btrim(p_center_name);
  v_admin_email text := lower(btrim(p_admin_email));
begin
  if length(v_center_name) not between 2 and 160 then
    raise exception 'A valid center name is required';
  end if;
  if v_admin_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
     or length(v_admin_email) > 320 then
    raise exception 'A valid administrator email is required';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '90 days' then
    raise exception 'Expiry must be within the next 90 days';
  end if;

  -- Issuing a replacement revokes any earlier unused code for this email.
  update center_registration_codes
     set revoked_at = now()
   where lower(center_registration_codes.admin_email) = v_admin_email
     and consumed_at is null
     and revoked_at is null;

  v_compact := upper(encode(gen_random_bytes(8), 'hex'));
  v_code := 'DL-' || substr(v_compact, 1, 4)
    || '-' || substr(v_compact, 5, 4)
    || '-' || substr(v_compact, 9, 4)
    || '-' || substr(v_compact, 13, 4);

  insert into center_registration_codes (
    code_hash, code_suffix, center_name, admin_email, expires_at
  )
  values (
    _center_registration_code_hash(v_code),
    right(v_compact, 4),
    v_center_name,
    v_admin_email,
    p_expires_at
  );

  return query
    select v_code, v_center_name, v_admin_email, p_expires_at;
end;
$$;

revoke all on function issue_center_registration_code(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function issue_center_registration_code(text, text, timestamptz)
  to service_role;

-- Pre-signup UX check. This never consumes a code and never returns a code or
-- a different administrator's email.
create or replace function check_center_registration_code(
  p_code text,
  p_email text
)
returns table (
  center_name text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_rate_limit(
    'center_registration_preview',
    10,
    900,
    lower(btrim(coalesce(p_email, '')))
  );

  return query
    select c.center_name, c.expires_at
      from center_registration_codes c
     where c.code_hash = _center_registration_code_hash(coalesce(p_code, ''))
       and lower(c.admin_email) = lower(btrim(coalesce(p_email, '')))
       and c.consumed_at is null
       and c.revoked_at is null
       and c.expires_at > now()
     limit 1;
end;
$$;

revoke all on function check_center_registration_code(text, text)
  from public;
grant execute on function check_center_registration_code(text, text)
  to anon, authenticated;

-- The earlier five-argument function remains as the internal atomic builder,
-- but clients can no longer execute it directly.
revoke all on function complete_center_setup(text, text, text, jsonb, jsonb)
  from public, anon, authenticated;

create or replace function complete_center_setup(
  p_center_name text,
  p_address text,
  p_phone text,
  p_classrooms jsonb,
  p_educator_emails jsonb,
  p_registration_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_email text;
  v_existing_daycare uuid;
  v_code center_registration_codes%rowtype;
  v_result jsonb;
  v_daycare_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before setting up a center';
  end if;

  select email, daycare_id
    into v_profile_email, v_existing_daycare
    from profiles
   where id = auth.uid()
   for update;

  if not found then
    raise exception 'Your profile is not ready yet. Please sign in again';
  end if;

  -- Safe retry after a network timeout: the internal builder only returns the
  -- already-attached center and performs no additional mutations.
  if v_existing_daycare is not null then
    return complete_center_setup(
      p_center_name, p_address, p_phone, p_classrooms, p_educator_emails
    );
  end if;

  perform assert_rate_limit(
    'center_registration_complete',
    8,
    1800,
    auth.uid()::text
  );

  select *
    into v_code
    from center_registration_codes c
   where c.code_hash = _center_registration_code_hash(
       coalesce(p_registration_code, '')
     )
     and lower(c.admin_email) = lower(v_profile_email)
     and c.consumed_at is null
     and c.revoked_at is null
     and c.expires_at > now()
   for update;

  if v_code.id is null then
    raise exception
      'This registration code is invalid, expired, already used, or belongs to another email address';
  end if;

  v_result := complete_center_setup(
    p_center_name, p_address, p_phone, p_classrooms, p_educator_emails
  );
  v_daycare_id := (v_result ->> 'daycare_id')::uuid;

  update center_registration_codes
     set consumed_at = now(),
         consumed_by = auth.uid(),
         daycare_id = v_daycare_id
   where id = v_code.id;

  return v_result || jsonb_build_object(
    'registration_code_suffix', v_code.code_suffix
  );
end;
$$;

revoke all on function complete_center_setup(
  text, text, text, jsonb, jsonb, text
) from public, anon;
grant execute on function complete_center_setup(
  text, text, text, jsonb, jsonb, text
) to authenticated;
