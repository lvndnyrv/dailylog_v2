-- Once activated, a schedule cannot lose the licensing inputs that made it valid.
create function public.protect_combination_room_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.room_combinations combination
    where combination.enabled and combination.activated_at is not null
      and new.id in (combination.source_classroom_id,combination.host_classroom_id))
    and (new.ratio_children_per_educator is null or new.ratio_children_per_educator < 1) then
    raise exception 'Disable this room''s combination before clearing its licensed ratio';
  end if;
  if exists (select 1 from public.room_combinations combination
    where combination.enabled and combination.activated_at is not null and combination.host_classroom_id=new.id)
    and (new.capacity is null or new.capacity < 1) then
    raise exception 'An activated combination needs a positive host room capacity';
  end if;
  return new;
end; $$;
revoke all on function public.protect_combination_room_settings() from public,anon,authenticated;
create trigger protect_combination_room_settings before update of capacity,ratio_children_per_educator on public.classrooms
  for each row execute function public.protect_combination_room_settings();
