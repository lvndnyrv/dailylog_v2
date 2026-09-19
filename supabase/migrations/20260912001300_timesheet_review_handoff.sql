-- Return an admin time-entry decision to the educator's in-app history. The
-- weekly mobile view reads the same entry status and note, so the alert opens
-- directly onto the reviewed timesheet.

create or replace function public.notify_staff_time_entry_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
  v_reviewer_name text;
  v_title text;
  v_body text;
  v_payload jsonb;
begin
  if new.status not in ('approved', 'rejected')
     or new.status is not distinct from old.status then
    return new;
  end if;

  select member.profile_id into v_recipient
    from public.staff_members member
   where member.id = new.staff_member_id
     and member.status = 'active'
     and member.archived_at is null;
  if v_recipient is null then return new; end if;

  select profile.full_name into v_reviewer_name
    from public.profiles profile
   where profile.id = new.approved_by;
  v_reviewer_name := coalesce(nullif(v_reviewer_name, ''), 'Your director');
  v_title := case new.status
    when 'approved' then 'Timesheet entry approved'
    else 'Timesheet entry needs correction'
  end;
  v_body := case new.status
    when 'approved' then v_reviewer_name || ' approved your time entry.'
    else v_reviewer_name || ' requested a correction' ||
      case when nullif(btrim(coalesce(new.notes, '')), '') is null then '.'
           else ': ' || btrim(new.notes) end
  end;
  v_payload := jsonb_build_object(
    'type', 'timesheet_review',
    'screen', 'WeeklyTimesheet',
    'entryId', new.id,
    'status', new.status,
    'channelId', 'default'
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    new.daycare_id,
    v_recipient,
    'timesheet_review',
    v_title,
    v_body,
    v_payload
  );

  return new;
end;
$$;

drop trigger if exists notify_staff_time_entry_review
  on public.staff_time_entries;
create trigger notify_staff_time_entry_review
  after update of status on public.staff_time_entries
  for each row execute function public.notify_staff_time_entry_review();

revoke all on function public.notify_staff_time_entry_review()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
