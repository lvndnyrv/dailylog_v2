-- Make family activity-consent changes auditable, tenant-safe and visible to
-- the active classroom team. Missing or declined consent remains restrictive.

create or replace function public.validate_activity_consent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.children%rowtype;
begin
  select * into v_child from public.children child where child.id = new.child_id;
  if v_child.id is null then raise exception 'Child not found'; end if;
  if new.kind not in (
    'Photo & media consent', 'Sunscreen application',
    'Field-trip permission', 'Water / splash play'
  ) then
    raise exception 'Unsupported consent type';
  end if;
  if new.version <> '1' then raise exception 'Unsupported consent version'; end if;

  new.daycare_id := v_child.daycare_id;
  if public.get_my_role() = 'parent' then
    if new.child_id not in (select public.my_child_ids()) then
      raise exception 'A linked parent account is required';
    end if;
    new.parent_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists validate_activity_consent on public.consents;
create trigger validate_activity_consent
  before insert or update on public.consents
  for each row execute function public.validate_activity_consent();

drop trigger if exists audit_activity_consents on public.consents;
create trigger audit_activity_consents
  after insert or update on public.consents
  for each row execute function public.audit_write();

create or replace function public.notify_activity_consent_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.children%rowtype;
  v_title text;
  v_body text;
  v_event_key text;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then return new; end if;
  if tg_op = 'UPDATE'
     and old.granted is not distinct from new.granted
     and old.revoked_at is not distinct from new.revoked_at then
    return new;
  end if;

  select * into v_child from public.children child where child.id = new.child_id;
  v_title := v_child.first_name || '''s permission was updated';
  v_body := new.kind || ' · ' || case
    when new.granted and new.revoked_at is null then 'Allowed' else 'Declined' end;
  v_event_key := 'activity-consent:' || new.id || ':' || extract(epoch from new.updated_at)::text;

  insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
  select new.daycare_id, recipient.id, 'activity_consent', v_title, v_body,
         jsonb_build_object(
           'type', 'activity_consent', 'screen', 'ChildConsents',
           'childId', new.child_id, 'consentId', new.id,
           'consentKind', new.kind, 'granted', new.granted,
           'eventKey', v_event_key
         )
    from public.profiles recipient
   where recipient.daycare_id = new.daycare_id
     and recipient.archived_at is null
     and public.profile_has_permission(recipient.id, 'children', 'view')
     and (
       recipient.role in ('owner_admin', 'admin')
       or (
         recipient.role = 'educator'
         and (
           recipient.classroom_id = v_child.classroom_id
           or exists (
             select 1 from public.educator_classrooms assignment
              where assignment.educator_id = recipient.id
                and assignment.classroom_id = v_child.classroom_id
           )
         )
       )
     )
     and not exists (
       select 1 from public.notifications existing
        where existing.profile_id = recipient.id
          and existing.payload->>'eventKey' = v_event_key
     );
  return new;
end;
$$;

drop trigger if exists notify_activity_consent_change on public.consents;
create trigger notify_activity_consent_change
  after insert or update on public.consents
  for each row execute function public.notify_activity_consent_change();

notify pgrst, 'reload schema';
