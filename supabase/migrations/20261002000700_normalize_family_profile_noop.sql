-- Treat whitespace and empty optional values as equivalent so a save that does
-- not change the visible profile does not create audit or notification noise.

create or replace function public.admin_update_family_profile(
  p_parent_id uuid,
  p_full_name text,
  p_phone text,
  p_preferred_language text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_profile public.profiles%rowtype;
  v_full_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_language text := nullif(btrim(coalesce(p_preferred_language, '')), '');
begin
  if auth.uid() is null or v_daycare_id is null
     or not public.has_permission('children', 'edit') then
    raise exception 'Child edit permission is required';
  end if;
  if v_full_name is null then
    raise exception 'Full name is required';
  end if;
  if length(v_full_name) > 120 or v_full_name ~ '[[:cntrl:]]' then
    raise exception 'Full name must be 120 characters or fewer';
  end if;
  if v_phone is not null and (length(v_phone) > 40 or v_phone ~ '[[:cntrl:]]') then
    raise exception 'Phone number must be 40 characters or fewer';
  end if;
  if v_language is null then
    raise exception 'Preferred language is required';
  end if;
  if length(v_language) > 40 or v_language ~ '[[:cntrl:]]' then
    raise exception 'Preferred language must be 40 characters or fewer';
  end if;

  select profile.* into v_profile
    from public.profiles profile
   where profile.id = p_parent_id
     and profile.daycare_id = v_daycare_id
     and profile.role = 'parent'
   for update;

  if v_profile.id is null then
    raise exception 'Family account not found';
  end if;

  if nullif(btrim(coalesce(v_profile.full_name, '')), '') is not distinct from v_full_name
     and nullif(btrim(coalesce(v_profile.phone, '')), '') is not distinct from v_phone
     and nullif(btrim(coalesce(v_profile.preferred_language, '')), '') is not distinct from v_language then
    return jsonb_build_object('parent_id', p_parent_id, 'changed', false);
  end if;

  update public.profiles
     set full_name = v_full_name,
         phone = v_phone,
         preferred_language = v_language,
         updated_at = now()
   where id = p_parent_id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    'family_profile_updated',
    'parent_profile',
    p_parent_id,
    jsonb_build_object('fullName', v_profile.full_name, 'phone', v_profile.phone, 'preferredLanguage', v_profile.preferred_language),
    jsonb_build_object('fullName', v_full_name, 'phone', v_phone, 'preferredLanguage', v_language)
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare_id,
    p_parent_id,
    'family_profile_updated',
    'Family profile updated',
    'The center updated your family contact details.',
    jsonb_build_object('type', 'family_profile_updated')
  );

  return jsonb_build_object('parent_id', p_parent_id, 'changed', true);
end;
$$;
