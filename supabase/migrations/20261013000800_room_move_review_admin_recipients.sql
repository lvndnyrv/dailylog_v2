-- Reviewing a saved move requires an administrator with children/edit. A
-- delegated educator may have that permission for other work, but cannot use
-- the admin-only room-move action. Keep both inbox and push recipients aligned.
create function public._room_move_review_admin_recipient_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid;
begin
  if new.kind <> 'room_transition_review' then return new; end if;
  v_recipient := case when tg_table_name = 'notifications' then new.profile_id else new.recipient_id end;
  if not exists (
    select 1 from public.profiles profile
     where profile.id = v_recipient
       and profile.daycare_id = new.daycare_id
       and profile.role in ('owner_admin', 'admin')
       and profile.archived_at is null
       and public.profile_has_permission(profile.id, 'children', 'edit')
  ) then return null; end if;
  return new;
end;
$$;
revoke all on function public._room_move_review_admin_recipient_guard() from public, anon, authenticated;

create trigger aa_room_move_review_admin_notification
  before insert on public.notifications
  for each row execute function public._room_move_review_admin_recipient_guard();
create trigger aa_room_move_review_admin_outbox
  before insert on public.notification_outbox
  for each row execute function public._room_move_review_admin_recipient_guard();
