-- A family-facing photo row must reference the actual private object uploaded
-- for that child and report, and retain its authenticated staff attribution.

create or replace function public.enforce_daily_log_photo_consent()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_child_id uuid;
begin
  select daily_log.child_id into v_child_id
    from public.daily_logs daily_log
   where daily_log.id = new.daily_log_id;
  if v_child_id is null then raise exception 'Daily log not found'; end if;

  if auth.role() = 'service_role' or auth.uid() is null then
    return new;
  end if;
  if not public.can_access_child_area(v_child_id, 'daily_logs', 'edit') then
    raise exception 'Daily log edit permission is required';
  end if;
  if not public.child_has_active_consent(v_child_id, 'Photo & media consent') then
    raise exception 'Photo consent is missing or declined for this child';
  end if;

  new.uploader_id := coalesce(new.uploader_id, auth.uid());
  if new.uploader_id is distinct from auth.uid() then
    raise exception 'Photo uploader must match the signed-in staff member';
  end if;
  if new.storage_path not like v_child_id::text || '/' || new.daily_log_id::text || '/%'
     or array_length(string_to_array(new.storage_path, '/'), 1) <> 3
     or split_part(new.storage_path, '/', 3) = '' then
    raise exception 'Photo path does not match this child and daily report';
  end if;
  if not exists (
    select 1 from storage.objects object
     where object.bucket_id = 'daily-log-photos'
       and object.name = new.storage_path
       and coalesce(object.owner_id, object.owner::text) = auth.uid()::text
       and not object.is_delete_marker
  ) then
    raise exception 'Upload the private photo before attaching it to the daily report';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_daily_log_photo_consent on public.photos;
create trigger enforce_daily_log_photo_consent
  before insert or update of daily_log_id, storage_path, uploader_id
  on public.photos
  for each row execute function public.enforce_daily_log_photo_consent();

revoke all on function public.enforce_daily_log_photo_consent()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
