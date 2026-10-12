-- Complete the admin -> parent medication handoff. Staff may prepare a
-- request, but only the linked parent can add the legal signature, label
-- evidence and activate it for educators.

create or replace function public.guard_medication_authorization_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if auth.uid() is null then
    return new;
  end if;

  v_role := public.get_my_role();
  if v_role not in ('owner_admin', 'admin', 'educator') then
    return new;
  end if;

  -- Existing signed authorizations remain governed by the immutable signed
  -- record trigger. This guard only owns staff-created unsigned requests.
  if tg_op = 'UPDATE' and old.signed_at is not null then
    return new;
  end if;

  if new.active
     or new.signed_at is not null
     or new.consented_at is not null
     or nullif(btrim(coalesce(new.signed_name, '')), '') is not null then
    raise exception 'Staff can request medication authorization, but a linked parent must sign and activate it';
  end if;

  if new.parent_id is null or not exists (
    select 1
      from public.parent_children link
     where link.child_id = new.child_id
       and link.parent_id = new.parent_id
  ) then
    raise exception 'Choose a linked parent to complete this medication authorization';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_medication_authorization_request
  on public.medication_authorizations;
create trigger guard_medication_authorization_request
  before insert or update on public.medication_authorizations
  for each row execute function public.guard_medication_authorization_request();

create or replace function public.route_medication_authorization_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child_name text;
  v_payload jsonb;
  v_title text;
  v_body text;
begin
  if auth.uid() is null
     or public.get_my_role() not in ('owner_admin', 'admin', 'educator')
     or new.active
     or new.signed_at is not null
     or new.parent_id is null then
    return new;
  end if;

  -- An ordinary edit should not repeatedly notify the same parent. A changed
  -- parent does receive their own first request because dedupe is per recipient.
  if tg_op = 'UPDATE'
     and new.parent_id is not distinct from old.parent_id then
    return new;
  end if;

  select concat_ws(' ', child.first_name, child.last_name)
    into v_child_name
    from public.children child
   where child.id = new.child_id;

  v_title := 'Medication authorization needs your review';
  v_body := new.name || ' for ' || v_child_name ||
    ' was prepared by your center. Review the directions, add the label photo, and sign before any dose can be given.';
  v_payload := jsonb_build_object(
    'screen', 'Medication',
    'type', 'medication_authorization_request',
    'childId', new.child_id,
    'authorizationId', new.id,
    'compose', true,
    'channelId', 'default'
  );

  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  ) values (
    new.daycare_id, new.parent_id, 'push', 'medication', v_title, v_body,
    v_payload, 'medication-authorization-request:' || new.id
  ) on conflict do nothing;

  if found then
    insert into public.notifications (
      daycare_id, profile_id, kind, title, body, payload
    ) values (
      new.daycare_id, new.parent_id, 'medication', v_title, v_body, v_payload
    );
  end if;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, after
  ) values (
    new.daycare_id,
    auth.uid(),
    'request_parent_authorization',
    'medication_authorization',
    new.id,
    jsonb_build_object(
      'childId', new.child_id,
      'parentId', new.parent_id,
      'status', 'consent_needed'
    )
  );

  return new;
end;
$$;

drop trigger if exists route_medication_authorization_request
  on public.medication_authorizations;
create trigger route_medication_authorization_request
  after insert or update of parent_id on public.medication_authorizations
  for each row execute function public.route_medication_authorization_request();

notify pgrst, 'reload schema';
