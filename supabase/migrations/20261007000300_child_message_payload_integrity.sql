-- Keep child-conversation messages and private attachment paths trustworthy even
-- when a client writes directly through the data API.

create or replace function public.enforce_child_message_payload_integrity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_prefix text;
begin
  -- Private staff conversations have their own RPC boundary. This guard covers
  -- the family <-> center child thread shared by web and mobile.
  if new.child_id is null then
    return new;
  end if;

  if new.sender_id is null then
    raise exception 'A sender is required for child messages';
  end if;

  new.body := btrim(new.body);
  if new.body = '' then
    raise exception 'Message text is required';
  end if;
  if char_length(new.body) > 4000 then
    raise exception 'Messages must be 4000 characters or fewer';
  end if;

  if new.attachment_kind is null then
    if new.attachment_path is not null
       or new.attachment_name is not null
       or new.attachment_mime is not null then
      raise exception 'Attachment metadata requires an attachment type';
    end if;
    return new;
  end if;

  if new.attachment_kind = 'daily_report' then
    if nullif(btrim(new.attachment_name), '') is null
       or new.attachment_path is not null
       or new.attachment_mime is not null then
      raise exception 'Daily report attachment metadata is invalid';
    end if;
    return new;
  end if;

  if new.attachment_kind not in ('photo', 'document') then
    raise exception 'Unsupported message attachment type';
  end if;

  if nullif(btrim(new.attachment_path), '') is null
     or nullif(btrim(new.attachment_name), '') is null
     or nullif(btrim(new.attachment_mime), '') is null then
    raise exception 'File attachments require a path, name, and content type';
  end if;
  if char_length(new.attachment_name) > 255
     or char_length(new.attachment_path) > 1000 then
    raise exception 'Attachment metadata is too long';
  end if;

  v_expected_prefix := new.child_id::text || '/' || new.sender_id::text || '/' || new.id::text || '/';
  if new.attachment_path not like v_expected_prefix || '%'
     or array_length(string_to_array(new.attachment_path, '/'), 1) <> 4
     or split_part(new.attachment_path, '/', 4) = '' then
    raise exception 'Attachment path does not match this message';
  end if;

  if new.attachment_kind = 'photo'
     and new.attachment_mime not in ('image/jpeg', 'image/png', 'image/heic') then
    raise exception 'Unsupported photo format';
  end if;
  if new.attachment_kind = 'document'
     and new.attachment_mime not in (
       'application/pdf',
       'text/plain',
       'application/msword',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
     ) then
    raise exception 'Unsupported document format';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_child_message_payload_integrity on public.messages;
create trigger enforce_child_message_payload_integrity
  before insert or update of body, sender_id, attachment_kind, attachment_path,
    attachment_name, attachment_mime
  on public.messages
  for each row execute function public.enforce_child_message_payload_integrity();

revoke all on function public.enforce_child_message_payload_integrity()
  from public, anon, authenticated;

-- Uploads happen before the message row is inserted. Bind every object to the
-- signed-in sender segment and require the documented four-part path:
-- <child>/<sender>/<message>/<filename>.
drop policy if exists "participants upload message attachments" on storage.objects;
create policy "participants upload message attachments" on storage.objects
  for insert with check (
    bucket_id = 'message-attachments'
    and public.can_access_child(public.storage_child_id(name))
    and split_part(name, '/', 2) = auth.uid()::text
    and split_part(name, '/', 3) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(name, '/', 4) <> ''
    and array_length(string_to_array(name, '/'), 1) = 4
  );

comment on function public.enforce_child_message_payload_integrity() is
  'Validates child-message text and binds attachment metadata to child, sender, and message IDs.';

notify pgrst, 'reload schema';
