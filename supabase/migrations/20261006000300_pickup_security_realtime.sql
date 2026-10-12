-- Mobile pickup safety alerts update in place for both the reporting educator
-- and the attendance approver reviewing the event.

do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'pickup_security_events'
  ) then
    alter publication supabase_realtime add table public.pickup_security_events;
  end if;
end;
$$;
