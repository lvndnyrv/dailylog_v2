-- Make the complete family-invitation lifecycle permission-bound and auditable.
-- Invite codes are deliberately excluded from audit payloads.

create or replace function public.audit_family_invite_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
  v_row public.child_invite_codes%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'INSERT' then
    v_row := new;
    v_action := 'family_invite_created';
  elsif tg_op = 'DELETE' then
    v_row := old;
    v_action := 'family_invite_cancelled';
  else
    v_row := new;
    if old.used_at is null and new.used_at is not null then
      v_action := 'family_invite_accepted';
    elsif old.expires_at is distinct from new.expires_at then
      v_action := 'family_invite_renewed';
    else
      return new;
    end if;
  end if;

  if tg_op <> 'INSERT' then
    v_before := jsonb_build_object(
      'childId', old.child_id,
      'email', old.email,
      'relationship', old.relationship,
      'expiresAt', old.expires_at,
      'usedAt', old.used_at,
      'usedBy', old.used_by
    );
  end if;
  if tg_op <> 'DELETE' then
    v_after := jsonb_build_object(
      'childId', new.child_id,
      'email', new.email,
      'relationship', new.relationship,
      'expiresAt', new.expires_at,
      'usedAt', new.used_at,
      'usedBy', new.used_by
    );
  end if;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_row.daycare_id,
    auth.uid(),
    v_action,
    'parent_invite',
    v_row.child_id,
    v_before,
    v_after
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists audit_family_invite_lifecycle on public.child_invite_codes;
create trigger audit_family_invite_lifecycle
  after insert or update or delete on public.child_invite_codes
  for each row execute function public.audit_family_invite_lifecycle();

create or replace function public.create_parent_invite(
  p_child_id uuid,
  p_email text,
  p_relationship text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_email text := lower(btrim(p_email));
  v_relationship text := nullif(btrim(p_relationship), '');
begin
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(p_child_id) then
    raise exception 'Child edit permission is required';
  end if;

  if v_email is null or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid parent email address';
  end if;
  if v_relationship is null then
    raise exception 'Relationship is required';
  end if;
  if length(v_relationship) > 60 or v_relationship ~ '[[:cntrl:]]' then
    raise exception 'Enter a valid relationship';
  end if;

  -- Serialize invitations for this child/email pair so rapid repeated taps
  -- cannot create two active codes.
  perform pg_advisory_xact_lock(hashtextextended(p_child_id::text || ':' || v_email, 0));

  if exists (
    select 1 from public.child_invite_codes invite
     where invite.child_id = p_child_id
       and lower(invite.email) = v_email
       and invite.used_at is null
  ) then
    raise exception 'A pending invitation already exists for this email. Renew or cancel it instead';
  end if;

  v_code := public.generate_invite_code();

  insert into public.child_invite_codes (
    daycare_id, child_id, code, email, relationship, created_by, expires_at
  )
  select child.daycare_id, child.id, v_code, v_email, v_relationship,
         auth.uid(), now() + interval '7 days'
    from public.children child
   where child.id = p_child_id
     and child.archived_at is null;

  if not found then
    raise exception 'This child is no longer available';
  end if;

  return v_code;
end;
$$;

create or replace function public.admin_renew_parent_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.child_invite_codes%rowtype;
  v_expires_at timestamptz := now() + interval '7 days';
begin
  select * into v_invite
    from public.child_invite_codes invite
   where invite.id = p_invite_id
   for update;

  if v_invite.id is null then
    raise exception 'This invitation is no longer available';
  end if;
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(v_invite.child_id) then
    raise exception 'Child edit permission is required';
  end if;
  if v_invite.used_at is not null then
    raise exception 'This invitation has already been accepted';
  end if;

  update public.child_invite_codes
     set expires_at = v_expires_at
   where id = p_invite_id;

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'child_id', v_invite.child_id,
    'email', v_invite.email,
    'relationship', v_invite.relationship,
    'code', v_invite.code,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.admin_cancel_parent_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.child_invite_codes%rowtype;
begin
  select * into v_invite
    from public.child_invite_codes invite
   where invite.id = p_invite_id
   for update;

  if v_invite.id is null then
    raise exception 'This invitation is no longer available';
  end if;
  if auth.uid() is null
     or not public.has_permission('children', 'edit')
     or not public.can_write_child(v_invite.child_id) then
    raise exception 'Child edit permission is required';
  end if;
  if v_invite.used_at is not null then
    raise exception 'An accepted invitation cannot be cancelled';
  end if;

  delete from public.child_invite_codes where id = p_invite_id;

  return jsonb_build_object(
    'invite_id', v_invite.id,
    'child_id', v_invite.child_id,
    'email', v_invite.email,
    'cancelled', true
  );
end;
$$;

revoke all on function public.create_parent_invite(uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_renew_parent_invite(uuid) from public, anon;
revoke all on function public.admin_cancel_parent_invite(uuid) from public, anon;
grant execute on function public.create_parent_invite(uuid, text, text) to authenticated;
grant execute on function public.admin_renew_parent_invite(uuid) to authenticated;
grant execute on function public.admin_cancel_parent_invite(uuid) to authenticated;

comment on function public.admin_renew_parent_invite(uuid) is
  'Renews an unused parent invitation for seven days; the lifecycle trigger records the action.';
comment on function public.admin_cancel_parent_invite(uuid) is
  'Cancels an unused parent invitation; the lifecycle trigger preserves a code-free audit record.';

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
         coalesce(nullif(btrim(child.first_name || ' ' || child.last_name), ''), 'Child record'),
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
     )
   order by audit.created_at desc
   limit v_limit;
end;
$$;
