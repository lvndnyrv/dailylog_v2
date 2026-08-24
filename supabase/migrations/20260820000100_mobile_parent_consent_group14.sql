-- Parent Mobile Group 14 — audited care-data consent and decline handling.

alter table public.parent_children
  add column if not exists consent_declined_at timestamptz,
  add column if not exists consent_version text;

update public.parent_children
   set consent_version = '2026-08-20'
 where consent_given_at is not null
   and consent_version is null;

alter table public.parent_children
  drop constraint if exists parent_children_consent_single_state;
alter table public.parent_children
  add constraint parent_children_consent_single_state check (
    consent_given_at is null or consent_declined_at is null
  );

create or replace function public.enforce_parent_child_self_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker text;
begin
  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;

  if auth.uid() = old.parent_id and public.get_my_role() = 'parent' then
    if new.parent_id is distinct from old.parent_id
       or new.child_id is distinct from old.child_id
       or new.relationship is distinct from old.relationship
       or new.pickup_authorized is distinct from old.pickup_authorized
       or new.is_primary is distinct from old.is_primary
       or new.created_at is distinct from old.created_at then
      raise exception 'Parent-child link details can only be changed by the center';
    end if;

    if new.consent_given_at is distinct from old.consent_given_at
       or new.consent_declined_at is distinct from old.consent_declined_at
       or new.consent_version is distinct from old.consent_version then
      v_marker := current_setting('dailylog.parent_consent_child', true);
      if v_marker is distinct from old.child_id::text then
        raise exception 'Use the DailyLog consent flow to update care-data consent';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_parent_child_self_update
  on public.parent_children;
create trigger enforce_parent_child_self_update
  before update on public.parent_children
  for each row execute function public.enforce_parent_child_self_update();

create or replace function public.set_parent_care_data_consent(
  p_child_id uuid,
  p_granted boolean,
  p_version text default '2026-08-20'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.parent_children%rowtype;
  v_daycare_id uuid;
  v_child_name text;
  v_parent_name text;
  v_changed boolean;
  v_now timestamptz := now();
  v_version text := nullif(btrim(p_version), '');
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'A signed-in parent account is required';
  end if;
  if p_child_id is null or p_granted is null then
    raise exception 'Child and consent decision are required';
  end if;
  if v_version is null or length(v_version) > 40 then
    raise exception 'A valid consent version is required';
  end if;

  perform public.assert_rate_limit(
    'parent_care_data_consent', 20, 600, p_child_id::text
  );

  select link.*
    into v_link
    from public.parent_children link
    join public.children child on child.id = link.child_id
   where link.parent_id = auth.uid()
     and link.child_id = p_child_id
     and child.archived_at is null
   for update of link;

  if v_link.child_id is null then
    raise exception 'Linked child not found';
  end if;

  select child.daycare_id,
         btrim(child.first_name || ' ' || child.last_name),
         coalesce(nullif(btrim(parent.full_name), ''), parent.email)
    into v_daycare_id, v_child_name, v_parent_name
    from public.children child
    join public.profiles parent on parent.id = auth.uid()
   where child.id = p_child_id;

  v_changed := case
    when p_granted then v_link.consent_given_at is null
    else v_link.consent_declined_at is null or v_link.consent_given_at is not null
  end;

  perform set_config('dailylog.parent_consent_child', p_child_id::text, true);
  update public.parent_children
     set consent_given_at = case when p_granted then v_now else null end,
         consent_declined_at = case when p_granted then null else v_now end,
         consent_version = v_version
   where parent_id = auth.uid() and child_id = p_child_id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id, auth.uid(),
    case when p_granted then 'parent_care_data_consent_granted'
         else 'parent_care_data_consent_declined' end,
    'parent_child_consent', p_child_id,
    jsonb_build_object(
      'consentGivenAt', v_link.consent_given_at,
      'consentDeclinedAt', v_link.consent_declined_at,
      'version', v_link.consent_version
    ),
    jsonb_build_object(
      'granted', p_granted,
      'decidedAt', v_now,
      'version', v_version
    )
  );

  if not p_granted and v_changed then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    )
    select v_daycare_id, admin.id, 'consent_declined',
           'Parent declined DailyLog consent',
           v_parent_name || ' declined care-data sharing for ' || v_child_name
             || '. Please follow up with the family in person.',
           jsonb_build_object(
             'type', 'consent_declined',
             'screen', 'ChildProfile',
             'childId', p_child_id,
             'parentId', auth.uid()
           )
      from public.profiles admin
     where admin.daycare_id = v_daycare_id
       and admin.role in ('owner_admin', 'admin')
       and admin.archived_at is null;
  end if;

  return jsonb_build_object(
    'childId', p_child_id,
    'granted', p_granted,
    'decidedAt', v_now,
    'version', v_version,
    'centerNotified', (not p_granted and v_changed)
  );
end;
$$;

revoke all on function public.set_parent_care_data_consent(uuid, boolean, text)
  from public, anon;
grant execute on function public.set_parent_care_data_consent(uuid, boolean, text)
  to authenticated;
