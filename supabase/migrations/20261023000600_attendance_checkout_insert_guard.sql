-- A new attendance row must not arrive already checked out via direct table
-- insertion; the same trusted workflow boundary applies to inserts and updates.
create or replace function public.enforce_attendance_checkout_workflow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role'
     or (auth.uid() is null and auth.role() is null) then return new; end if;
  if current_setting('dailylog.attendance_checkout_rpc', true) is distinct from 'allowed' then
    if tg_op = 'INSERT' and new.checked_out_at is not null then
      raise exception 'Use verified pickup or an audited attendance correction to change check-out';
    end if;
    if tg_op = 'UPDATE' then
      if new.checked_out_at is distinct from old.checked_out_at then
        raise exception 'Use verified pickup or an audited attendance correction to change check-out';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger enforce_attendance_checkout_insert_workflow
  before insert on public.attendance_records
  for each row execute function public.enforce_attendance_checkout_workflow();
