-- A published daily report is a family-facing record. Keep every part of that
-- record immutable after publication, require the atomic publication RPC for
-- finalization, and include photos in the live family feed.

create or replace function public.protect_daily_log_finalization()
returns trigger
language plpgsql
set search_path = public
as $$
begin
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
  before update or delete on public.daily_logs
  for each row execute function public.protect_daily_log_finalization();

create or replace function public.protect_final_daily_log_entry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old_log_id uuid;
  v_new_log_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_log_id := old.daily_log_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_log_id := new.daily_log_id;
  end if;

  if (v_old_log_id is not null and exists (
        select 1 from public.daily_logs log
         where log.id = v_old_log_id and coalesce(log.sent_to_parents, false)
      ))
     or (v_new_log_id is not null and exists (
        select 1 from public.daily_logs log
         where log.id = v_new_log_id and coalesce(log.sent_to_parents, false)
      )) then
    raise exception using
      errcode = '55000',
      message = 'Entries in a published daily report are final and cannot be changed';
  end if;

  return coalesce(new, old);
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meal_entries', 'diaper_entries', 'sleep_entries',
    'activity_entries', 'supply_requests', 'photos'
  ] loop
    execute format('drop trigger if exists protect_final_daily_log_entry on public.%I', table_name);
    execute format(
      'create trigger protect_final_daily_log_entry before insert or update or delete on public.%I for each row execute function public.protect_final_daily_log_entry()',
      table_name
    );
  end loop;
end
$$;

create or replace function public.audit_daily_log_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    new.daycare_id,
    auth.uid(),
    'publish',
    'daily_log',
    new.id,
    jsonb_build_object('sentToParents', false),
    jsonb_build_object(
      'sentToParents', true,
      'sentAt', new.sent_at,
      'childId', new.child_id,
      'logDate', new.log_date
    )
  );
  return new;
end;
$$;

drop trigger if exists audit_daily_log_publication on public.daily_logs;
create trigger audit_daily_log_publication
  after update on public.daily_logs
  for each row
  when (
    not coalesce(old.sent_to_parents, false)
    and coalesce(new.sent_to_parents, false)
  )
  execute function public.audit_daily_log_publication();

create or replace function public.can_manage_daily_log_photo_object(
  p_name text,
  p_allow_orphan_cleanup boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage
as $$
declare
  v_child_id uuid;
  v_log_id uuid;
  v_final boolean;
begin
  v_child_id := split_part(p_name, '/', 1)::uuid;
  v_log_id := split_part(p_name, '/', 2)::uuid;

  select coalesce(log.sent_to_parents, false)
    into v_final
    from public.daily_logs log
   where log.id = v_log_id
     and log.child_id = v_child_id;

  if not found or not public.can_access_child_area(v_child_id, 'daily_logs', 'edit') then
    return false;
  end if;

  if not v_final then
    return true;
  end if;

  return p_allow_orphan_cleanup and not exists (
    select 1 from public.photos photo
     where photo.daily_log_id = v_log_id
       and photo.storage_path = p_name
  );
exception
  when invalid_text_representation then return false;
end;
$$;

drop policy if exists "staff write log photos" on storage.objects;
create policy "staff write log photos" on storage.objects
  for insert with check (
    bucket_id = 'daily-log-photos'
    and public.can_manage_daily_log_photo_object(name, false)
  );

drop policy if exists "staff update log photos" on storage.objects;
create policy "staff update log photos" on storage.objects
  for update using (
    bucket_id = 'daily-log-photos'
    and public.can_manage_daily_log_photo_object(name, false)
  ) with check (
    bucket_id = 'daily-log-photos'
    and public.can_manage_daily_log_photo_object(name, false)
  );

drop policy if exists "staff delete log photos" on storage.objects;
create policy "staff delete log photos" on storage.objects
  for delete using (
    bucket_id = 'daily-log-photos'
    and public.can_manage_daily_log_photo_object(name, true)
  );

create or replace function public.publish_daily_log(p_daily_log_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_log public.daily_logs%rowtype;
  v_child public.children%rowtype;
  v_sent_at timestamptz;
  v_queued integer;
  v_entry_count integer;
begin
  if auth.uid() is null or not public.is_staff() then
    raise exception 'A signed-in staff account is required';
  end if;

  select * into v_log
    from public.daily_logs daily_log
   where daily_log.id = p_daily_log_id
   for update;
  if v_log.id is null then raise exception 'Daily log not found'; end if;
  if not public.can_access_child_area(v_log.child_id, 'daily_logs', 'edit') then
    raise exception 'Daily log edit permission is required';
  end if;
  if v_log.log_date > public.center_today() then
    raise exception 'A future daily log cannot be sent';
  end if;

  select * into v_child from public.children child where child.id = v_log.child_id;
  if v_child.id is null or v_child.archived_at is not null then
    raise exception 'Child not found or unavailable';
  end if;
  if coalesce(v_child.enrolled_on, '-infinity'::date) > v_log.log_date then
    raise exception 'A daily log cannot be sent before the enrollment start date';
  end if;

  if not coalesce(v_log.sent_to_parents, false) then
    select
      (select count(*) from public.meal_entries meal where meal.daily_log_id = v_log.id)
      + (select count(*) from public.sleep_entries sleep where sleep.daily_log_id = v_log.id)
      + (select count(*) from public.diaper_entries diaper where diaper.daily_log_id = v_log.id)
      + (select count(*) from public.activity_entries activity where activity.daily_log_id = v_log.id)
      into v_entry_count;

    if nullif(btrim(v_log.notes), '') is null
       and nullif(btrim(v_log.comments), '') is null
       and coalesce(v_entry_count, 0) < 2 then
      raise exception 'Add a note or at least two daily updates before sending the final report';
    end if;
  end if;

  v_sent_at := coalesce(v_log.sent_at, now());
  perform set_config('dailylog.publication', 'on', true);
  update public.daily_logs
     set sent_to_parents = true,
         sent_at = v_sent_at
   where id = v_log.id
     and (not coalesce(sent_to_parents, false) or sent_at is null);
  perform set_config('dailylog.publication', 'off', true);

  v_queued := public.enqueue_child_notification(
    v_log.child_id,
    'daily_log',
    v_child.first_name || '''s daily log is ready 📋',
    'Tap to see how ' || v_child.first_name || '''s day went at daycare.',
    jsonb_build_object(
      'dailyLogId', v_log.id,
      'childId', v_log.child_id,
      'logDate', v_log.log_date,
      'type', 'daily_log',
      'channelId', 'default'
    ),
    'daily-log:' || v_log.child_id || ':' || v_log.log_date,
    array['push']::text[]
  );

  return jsonb_build_object(
    'dailyLogId', v_log.id,
    'childId', v_log.child_id,
    'logDate', v_log.log_date,
    'sentAt', v_sent_at,
    'queuedRecipients', v_queued
  );
end;
$$;

revoke all on function public.publish_daily_log(uuid) from public, anon;
grant execute on function public.publish_daily_log(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'photos'
  ) then
    alter publication supabase_realtime add table public.photos;
  end if;
end
$$;

notify pgrst, 'reload schema';
