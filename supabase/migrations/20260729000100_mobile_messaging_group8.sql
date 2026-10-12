-- ============================================================================
-- DailyLog mobile design group 8
-- Message attachments + durable announcement read state
-- ============================================================================

alter table messages
  add column if not exists attachment_kind text,
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists attachment_mime text;

alter table messages
  drop constraint if exists messages_attachment_kind_check;

alter table messages
  add constraint messages_attachment_kind_check
  check (
    attachment_kind is null
    or attachment_kind in ('photo', 'document', 'daily_report')
  );

create table if not exists announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, profile_id)
);

create index if not exists announcement_reads_profile_idx
  on announcement_reads (profile_id, read_at desc);

alter table announcement_reads enable row level security;

drop policy if exists "users read own announcement receipts" on announcement_reads;
create policy "users read own announcement receipts" on announcement_reads
  for select using (profile_id = auth.uid());

drop policy if exists "users create own announcement receipts" on announcement_reads;
create policy "users create own announcement receipts" on announcement_reads
  for insert with check (
    profile_id = auth.uid()
    and announcement_id in (select id from announcements)
  );

drop policy if exists "users update own announcement receipts" on announcement_reads;
create policy "users update own announcement receipts" on announcement_reads
  for update using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

grant select, insert, update on announcement_reads to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'message-attachments',
  'message-attachments',
  false,
  10485760,
  array[
    'image/jpeg',
    'image/png',
    'image/heic',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Paths begin with the child id: "<child_id>/<sender_id>/<message_id>/<file>".
drop policy if exists "participants upload message attachments" on storage.objects;
create policy "participants upload message attachments" on storage.objects
  for insert with check (
    bucket_id = 'message-attachments'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "participants read message attachments" on storage.objects;
create policy "participants read message attachments" on storage.objects
  for select using (
    bucket_id = 'message-attachments'
    and can_access_child(storage_child_id(name))
  );

drop policy if exists "owners remove message attachments" on storage.objects;
create policy "owners remove message attachments" on storage.objects
  for delete using (
    bucket_id = 'message-attachments'
    and can_access_child(storage_child_id(name))
    and (owner_id = auth.uid()::text or is_staff())
  );
