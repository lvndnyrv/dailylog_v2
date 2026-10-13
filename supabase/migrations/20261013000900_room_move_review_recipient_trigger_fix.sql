-- A CASE over NEW fields still resolves both record fields for a trigger on
-- different tables. Select the recipient in a table-specific branch instead.
create or replace function public._room_move_review_admin_recipient_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_recipient uuid;
begin
  if new.kind <> 'room_transition_review' then return new; end if;
  if tg_table_name = 'notifications' then
    v_recipient := new.profile_id;
  else
    v_recipient := new.recipient_id;
  end if;
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
