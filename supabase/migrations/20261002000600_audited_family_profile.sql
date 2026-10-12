-- Give administrators a narrow, audited way to correct family contact details.
-- Sign-in email and account role remain outside this workflow.

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

  if v_profile.full_name is not distinct from v_full_name
     and v_profile.phone is not distinct from v_phone
     and v_profile.preferred_language is not distinct from v_language then
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

revoke all on function public.admin_update_family_profile(uuid, text, text, text) from public, anon;
grant execute on function public.admin_update_family_profile(uuid, text, text, text) to authenticated;

comment on function public.admin_update_family_profile(uuid, text, text, text) is
  'Updates non-auth family contact details, records an audit event and notifies the parent.';

create or replace function public.admin_list_family_access_activity(
  p_parent_id uuid,
  p_limit integer default 20
)
returns table (
  event_id uuid,
  action text,
  child_id uuid,
  child_name text,
  actor_name text,
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if auth.uid() is null or v_daycare_id is null
     or not public.has_permission('reports', 'view') then
    raise exception 'Report viewing permission is required';
  end if;
  if not exists (
    select 1 from public.profiles family
     where family.id = p_parent_id
       and family.daycare_id = v_daycare_id
       and family.role = 'parent'
  ) then
    raise exception 'Family account not found';
  end if;

  return query
  select audit.id, audit.action, audit.entity_id,
         case when audit.entity_type = 'parent_profile' then 'Family profile'
              else coalesce(nullif(btrim(child.first_name || ' ' || child.last_name), ''), 'Child record') end,
         coalesce(nullif(btrim(actor.full_name), ''), actor.email, 'DailyLog'),
         audit.before, audit.after, audit.created_at
    from public.audit_log audit
    left join public.children child on child.id = audit.entity_id
    left join public.profiles actor on actor.id = audit.actor_id
   where audit.daycare_id = v_daycare_id
     and (
       (
         audit.entity_type = 'parent_child_access'
         and (
           audit.before ->> 'parentId' = p_parent_id::text
           or audit.after ->> 'parentId' = p_parent_id::text
           or audit.before ->> 'primaryParentId' = p_parent_id::text
           or audit.after ->> 'primaryParentId' = p_parent_id::text
         )
       )
       or (
         audit.entity_type = 'parent_invite'
         and audit.action = 'family_invite_accepted'
         and audit.after ->> 'usedBy' = p_parent_id::text
       )
       or (audit.entity_type = 'parent_profile' and audit.entity_id = p_parent_id)
     )
   order by audit.created_at desc
   limit v_limit;
end;
$$;
