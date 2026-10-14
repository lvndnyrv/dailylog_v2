-- A newly approved center may defer room setup, but every room it does create
-- must have the same complete operating settings as later admin-created rooms.
create or replace function public.complete_center_setup(
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
  v_code public.center_registration_codes%rowtype;
  v_result jsonb;
  v_daycare_id uuid;
  v_room jsonb;
  v_name text;
  v_min integer;
  v_max integer;
  v_capacity integer;
  v_ratio integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in before setting up a center';
  end if;

  select email, daycare_id into v_profile_email, v_existing_daycare
  from public.profiles where id = auth.uid() for update;
  if not found then
    raise exception 'Your profile is not ready yet. Please sign in again';
  end if;

  -- Retrying a completed setup is read-only, even if the original client no
  -- longer has its first request's room draft.
  if v_existing_daycare is not null then
    return public.complete_center_setup(
      p_center_name, p_address, p_phone, p_classrooms, p_educator_emails
    );
  end if;

  perform public.assert_rate_limit('center_registration_complete', 8, 1800, auth.uid()::text);
  select * into v_code
  from public.center_registration_codes c
  where c.code_hash = public._center_registration_code_hash(coalesce(p_registration_code, ''))
    and lower(c.admin_email) = lower(v_profile_email)
    and c.consumed_at is null and c.revoked_at is null and c.expires_at > now()
  for update;
  if v_code.id is null then
    raise exception 'This registration code is invalid, expired, already used, or belongs to another email address';
  end if;

  if jsonb_typeof(coalesce(p_classrooms, '[]'::jsonb)) <> 'array' then
    raise exception 'Classrooms must be a list';
  end if;
  for v_room in select value from jsonb_array_elements(coalesce(p_classrooms, '[]'::jsonb)) loop
    if jsonb_typeof(v_room) <> 'object' then
      raise exception 'Each classroom must be an object';
    end if;
    v_name := btrim(v_room->>'name');
    if v_name is null or length(v_name) not between 1 and 100
      or nullif(btrim(v_room->>'age_group'), '') is null
      or length(v_room->>'age_group') > 100 then
      raise exception 'Each classroom needs a name and age band (up to 100 characters)';
    end if;
    if coalesce(v_room->>'min_age_months', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_room->>'max_age_months', '') !~ '^[0-9]{1,3}$'
      or coalesce(v_room->>'capacity', '') !~ '^[1-9][0-9]{0,3}$'
      or coalesce(v_room->>'ratio', '') !~ '^[1-9][0-9]{0,2}$' then
      raise exception 'Each classroom needs whole-number ages, capacity and children per educator';
    end if;
    v_min := (v_room->>'min_age_months')::integer;
    v_max := (v_room->>'max_age_months')::integer;
    v_capacity := (v_room->>'capacity')::integer;
    v_ratio := (v_room->>'ratio')::integer;
    if v_min > 215 or v_max <= v_min or v_max > 216
      or v_capacity > 9999 or v_ratio > 999 then
      raise exception 'Classroom age, capacity or ratio is outside the supported range';
    end if;
  end loop;

  -- The original builder creates center, owner and invitations atomically.
  -- Filling the validated room settings remains in that same transaction.
  v_result := public.complete_center_setup(
    p_center_name, p_address, p_phone, p_classrooms, p_educator_emails
  );
  v_daycare_id := (v_result->>'daycare_id')::uuid;
  for v_room in select value from jsonb_array_elements(coalesce(p_classrooms, '[]'::jsonb)) loop
    update public.classrooms
    set min_age_months = (v_room->>'min_age_months')::integer,
        max_age_months = (v_room->>'max_age_months')::integer,
        capacity = (v_room->>'capacity')::integer,
        ratio_children_per_educator = (v_room->>'ratio')::integer
    where daycare_id = v_daycare_id and archived_at is null
      and lower(btrim(name)) = lower(btrim(v_room->>'name'));
    if not found then
      raise exception 'A classroom was not saved; center setup was rolled back';
    end if;
  end loop;

  update public.center_registration_codes
  set consumed_at = now(), consumed_by = auth.uid(), daycare_id = v_daycare_id
  where id = v_code.id;

  return v_result || jsonb_build_object('registration_code_suffix', v_code.code_suffix);
end;
$$;

revoke all on function public.complete_center_setup(text, text, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.complete_center_setup(text, text, text, jsonb, jsonb, text) to authenticated;
