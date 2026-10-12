-- Close the remaining direct-insert path: clients must not be able to create a
-- daily log that is already marked final without using the publication RPC.

create or replace function public.protect_daily_log_finalization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(new.sent_to_parents, false) then
      raise exception using
        errcode = '42501',
        message = 'Create the daily report as a draft, then use publish_daily_log to send it';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if coalesce(old.sent_to_parents, false) then
      raise exception using
        errcode = '55000',
        message = 'A published daily report cannot be deleted';
    end if;
    return old;
  end if;

  if coalesce(old.sent_to_parents, false) then
    raise exception using
      errcode = '55000',
      message = 'A published daily report is final and cannot be changed';
  end if;

  if coalesce(new.sent_to_parents, false) then
    if coalesce(current_setting('dailylog.publication', true), '') <> 'on' then
      raise exception using
        errcode = '42501',
        message = 'Use publish_daily_log to send a final report';
    end if;

    if (to_jsonb(new) - array['sent_to_parents', 'sent_at', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['sent_to_parents', 'sent_at', 'updated_at']) then
      raise exception using
        errcode = '55000',
        message = 'Publication cannot change daily report content';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists protect_daily_log_finalization on public.daily_logs;
create trigger protect_daily_log_finalization
  before insert or update or delete on public.daily_logs
  for each row execute function public.protect_daily_log_finalization();

notify pgrst, 'reload schema';
