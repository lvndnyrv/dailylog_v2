-- Keep publication time on the transaction clock. The delivery trigger uses
-- now() as its visibility boundary, so clock_timestamp() could be a few
-- milliseconds ahead and incorrectly treat a due publication as future.

create or replace function public.process_due_announcements()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.announcements announcement
     set published_at = now(),
         updated_at = now()
   where announcement.published_at is null
     and announcement.cancelled_at is null
     and announcement.scheduled_for is not null
     and announcement.scheduled_for <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

