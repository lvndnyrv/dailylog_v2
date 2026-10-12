-- Let an educator correct only their own rejected entry, then return it to the
-- admin review queue. Approved entries remain immutable to the educator.

create or replace function public.resubmit_time_entry_correction(
  p_entry_id uuid,
  p_clocked_in_at timestamptz,
  p_clocked_out_at timestamptz,
  p_break_minutes integer default 0
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entry public.staff_time_entries%rowtype;
  v_duration numeric;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  if p_clocked_out_at <= p_clocked_in_at then raise exception 'Clock-out must be after clock-in'; end if;
  v_duration := extract(epoch from (p_clocked_out_at - p_clocked_in_at)) / 60;
  if p_break_minutes < 0 or p_break_minutes >= v_duration or p_break_minutes > 720 then
    raise exception 'Break minutes must be shorter than the shift';
  end if;
  if p_clocked_out_at > now() + interval '5 minutes' then
    raise exception 'Clock-out cannot be in the future';
  end if;

  select entry.* into v_entry
    from public.staff_time_entries entry
    join public.staff_members member on member.id = entry.staff_member_id
   where entry.id = p_entry_id
     and member.profile_id = auth.uid()
     and member.status = 'active'
     and member.archived_at is null
   for update of entry;
  if v_entry.id is null then raise exception 'Time entry not found'; end if;
  if v_entry.status <> 'rejected' then raise exception 'Only a rejected time entry can be resubmitted'; end if;

  update public.staff_time_entries
     set clocked_in_at = p_clocked_in_at,
         clocked_out_at = p_clocked_out_at,
         break_minutes = p_break_minutes,
         status = 'submitted',
         approved_by = null,
         approved_at = null
   where id = v_entry.id;
end;
$$;

revoke all on function public.resubmit_time_entry_correction(uuid, timestamptz, timestamptz, integer)
  from public, anon;
grant execute on function public.resubmit_time_entry_correction(uuid, timestamptz, timestamptz, integer)
  to authenticated;

notify pgrst, 'reload schema';
