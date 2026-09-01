-- Parent Mobile Group 17 — production announcement delivery and child-aware RSVPs.

do $$
declare
  v_table text;
begin
  foreach v_table in array array['announcements', 'announcement_rsvps', 'announcement_reads']
  loop
    if not exists (
      select 1
        from pg_publication_tables publication_table
       where publication_table.pubname = 'supabase_realtime'
         and publication_table.schemaname = 'public'
         and publication_table.tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;

drop function if exists public.send_mobile_event_rsvp(uuid, text, int);

create function public.send_mobile_event_rsvp(
  p_announcement_id uuid,
  p_response text,
  p_guests int default 1,
  p_child_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_announcement public.announcements%rowtype;
  v_child public.children%rowtype;
  v_guests int;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent' then
    raise exception 'A parent account is required';
  end if;
  if p_response not in ('yes', 'maybe', 'no') then
    raise exception 'Choose Yes, Maybe or No';
  end if;

  select announcement.* into v_announcement
    from public.announcements announcement
   where announcement.id = p_announcement_id
     and announcement.rsvp_enabled
     and announcement.event_at is not null
     and exists (
       select 1
         from public.parent_children family_link
         join public.children child on child.id = family_link.child_id
        where family_link.parent_id = auth.uid()
          and child.archived_at is null
          and child.daycare_id = announcement.daycare_id
          and (
            announcement.classroom_id is null
            or child.classroom_id = announcement.classroom_id
          )
     );
  if v_announcement.id is null then
    raise exception 'Event not found or this family is not invited';
  end if;
  if v_announcement.event_at <= now() then
    raise exception 'This event has already started';
  end if;

  select child.* into v_child
    from public.parent_children family_link
    join public.children child on child.id = family_link.child_id
   where family_link.parent_id = auth.uid()
     and child.archived_at is null
     and child.daycare_id = v_announcement.daycare_id
     and (v_announcement.classroom_id is null or child.classroom_id = v_announcement.classroom_id)
     and (p_child_id is null or child.id = p_child_id)
   order by child.first_name, child.last_name
   limit 1;
  if v_child.id is null then
    raise exception 'The selected child is not invited to this event';
  end if;

  v_guests := case
    when p_response = 'no' then 0
    else greatest(1, least(coalesce(p_guests, 1), 20))
  end;

  perform public.assert_rate_limit('event_rsvp', 30, 600, p_announcement_id::text);
  insert into public.announcement_rsvps (
    daycare_id, announcement_id, profile_id, child_id,
    response, guests, updated_at
  ) values (
    v_announcement.daycare_id, v_announcement.id, auth.uid(), v_child.id,
    p_response, v_guests, now()
  )
  on conflict (announcement_id, profile_id) do update
    set child_id = excluded.child_id,
        response = excluded.response,
        guests = excluded.guests,
        updated_at = now();

  return jsonb_build_object(
    'response', p_response,
    'guests', v_guests,
    'childId', v_child.id,
    'childName', trim(concat_ws(' ', v_child.first_name, v_child.last_name)),
    'updatedAt', now()
  );
end;
$$;

revoke all on function public.send_mobile_event_rsvp(uuid, text, int, uuid) from public;
grant execute on function public.send_mobile_event_rsvp(uuid, text, int, uuid) to authenticated;
