-- Close the parent -> administrator -> educator pickup-review handoff.
-- Parent-created pickup people already remain credential-blocked until review;
-- this migration ensures only administrators who can actually review receive
-- the alert and preserves a compliance trail for every lifecycle decision.

create or replace function public.filter_pickup_review_recipient()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient_id uuid;
begin
  if new.kind <> 'pickup_review' then return new; end if;

  begin
    v_recipient_id := coalesce(
      nullif(to_jsonb(new)->>'profile_id', '')::uuid,
      nullif(to_jsonb(new)->>'recipient_id', '')::uuid
    );
  exception when invalid_text_representation then
    v_recipient_id := null;
  end;

  if v_recipient_id is null
     or not public.profile_has_permission(v_recipient_id, 'children', 'edit') then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists filter_pickup_review_notification on public.notifications;
create trigger filter_pickup_review_notification
  before insert on public.notifications
  for each row execute function public.filter_pickup_review_recipient();

drop trigger if exists filter_pickup_review_outbox on public.notification_outbox;
create trigger filter_pickup_review_outbox
  before insert on public.notification_outbox
  for each row execute function public.filter_pickup_review_recipient();

drop trigger if exists audit_child_pickup_created on public.child_pickups;
create trigger audit_child_pickup_created
  after insert on public.child_pickups
  for each row execute function public.audit_write();

drop trigger if exists audit_child_pickup_lifecycle on public.child_pickups;
create trigger audit_child_pickup_lifecycle
  after update on public.child_pickups
  for each row
  when (
    old.approval_status is distinct from new.approval_status
    or old.reviewed_by is distinct from new.reviewed_by
    or old.archived_at is distinct from new.archived_at
  )
  execute function public.audit_write();

revoke all on function public.filter_pickup_review_recipient() from public, anon, authenticated;

comment on function public.filter_pickup_review_recipient() is
  'Suppresses pickup-review alerts for recipients without effective children-edit permission.';

notify pgrst, 'reload schema';
