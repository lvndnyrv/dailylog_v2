-- Group 13: keep child roster moves inside an educator's assigned rooms and
-- make the medical/emergency profile an atomic, explicitly reviewed record.

drop policy if exists "staff update children with permission" on public.children;
create policy "staff update children with permission"
on public.children for update
using (
  public.has_permission('children', 'edit')
  and public.can_write_child(id)
)
with check (
  public.has_permission('children', 'edit')
  and daycare_id = public.get_my_daycare_id()
  and (
    public.is_admin()
    or (
      public.get_my_role() = 'educator'
      and classroom_id in (select public.my_classroom_ids())
    )
  )
);

create or replace function public.validate_child_profile_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_contact jsonb;
  v_allergy text;
  v_allergies text[] := '{}';
begin
  new.first_name := btrim(coalesce(new.first_name, ''));
  new.last_name := btrim(coalesce(new.last_name, ''));

  if char_length(new.first_name) not between 1 and 100 then
    raise exception 'First name must be between 1 and 100 characters.';
  end if;
  if char_length(new.last_name) not between 1 and 100 then
    raise exception 'Last name must be between 1 and 100 characters.';
  end if;
  if new.date_of_birth is not null and new.date_of_birth > public.center_today() then
    raise exception 'Date of birth cannot be in the future.';
  end if;
  if char_length(coalesce(new.medical_notes, '')) > 2000 then
    raise exception 'Medical notes cannot exceed 2,000 characters.';
  end if;
  if new.setup_state is null or jsonb_typeof(new.setup_state) <> 'object' then
    raise exception 'Child setup state must be an object.';
  end if;

  if coalesce(array_length(new.allergies, 1), 0) > 20 then
    raise exception 'A child can have at most 20 allergy entries.';
  end if;
  foreach v_allergy in array coalesce(new.allergies, '{}') loop
    v_allergy := btrim(v_allergy);
    if v_allergy = '' or char_length(v_allergy) > 100 then
      raise exception 'Each allergy must be between 1 and 100 characters.';
    end if;
    if not exists (
      select 1 from unnest(v_allergies) existing
       where lower(existing) = lower(v_allergy)
    ) then
      v_allergies := array_append(v_allergies, v_allergy);
    end if;
  end loop;
  new.allergies := v_allergies;

  if new.emergency_contacts is null or jsonb_typeof(new.emergency_contacts) <> 'array' then
    raise exception 'Emergency contacts must be a list.';
  end if;
  if jsonb_array_length(new.emergency_contacts) > 10 then
    raise exception 'A child can have at most 10 emergency contacts.';
  end if;
  for v_contact in select value from jsonb_array_elements(new.emergency_contacts) loop
    if jsonb_typeof(v_contact) <> 'object'
       or btrim(coalesce(v_contact->>'name', '')) = ''
       or btrim(coalesce(v_contact->>'phone', '')) = '' then
      raise exception 'Each emergency contact needs a name and phone number.';
    end if;
    if char_length(btrim(v_contact->>'name')) > 100
       or char_length(btrim(v_contact->>'phone')) > 40
       or char_length(btrim(coalesce(v_contact->>'relation', ''))) > 80 then
      raise exception 'Emergency contact details are too long.';
    end if;
    if length(regexp_replace(v_contact->>'phone', '[^0-9]', '', 'g')) < 7 then
      raise exception 'Enter a valid emergency contact phone number.';
    end if;
  end loop;

  return new;
end
$$;

drop trigger if exists validate_child_profile_integrity on public.children;
create trigger validate_child_profile_integrity
before insert or update on public.children
for each row execute function public.validate_child_profile_integrity();

create or replace function public.save_child_care_profile(
  p_child_id uuid,
  p_allergies text[],
  p_medical_notes text,
  p_emergency_contacts jsonb,
  p_no_known_medical_needs boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.children;
begin
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'You do not have access to update this child.';
  end if;

  if coalesce(p_no_known_medical_needs, false)
     and (
       coalesce(array_length(p_allergies, 1), 0) > 0
       or btrim(coalesce(p_medical_notes, '')) <> ''
     ) then
    raise exception 'Clear allergies and medical notes before marking no known medical needs.';
  end if;

  update public.children
     set allergies = coalesce(p_allergies, '{}'),
         medical_notes = nullif(btrim(coalesce(p_medical_notes, '')), ''),
         emergency_contacts = coalesce(p_emergency_contacts, '[]'::jsonb),
         setup_state = coalesce(setup_state, '{}'::jsonb) || jsonb_build_object(
           'medical_reviewed', true,
           'no_known_medical_needs', coalesce(p_no_known_medical_needs, false),
           'medical_reviewed_at', now()
         ),
         updated_at = now()
   where id = p_child_id
   returning * into v_child;

  if v_child.id is null then
    raise exception 'Child not found.';
  end if;

  return jsonb_build_object(
    'allergies', to_jsonb(v_child.allergies),
    'medical_notes', v_child.medical_notes,
    'emergency_contacts', v_child.emergency_contacts,
    'setup_state', v_child.setup_state
  );
end
$$;

revoke all on function public.save_child_care_profile(uuid, text[], text, jsonb, boolean) from public;
grant execute on function public.save_child_care_profile(uuid, text[], text, jsonb, boolean) to authenticated;
