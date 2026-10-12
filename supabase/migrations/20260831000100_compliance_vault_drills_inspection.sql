-- Admin design group 12: immutable vault versions, drill records and live,
-- explicitly shared inspection packs. No private table is readable by anon.
create table public.compliance_documents (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 180),
  category text not null check (category in ('license','insurance','inspection','policy','other')),
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  expires_on date,
  watch_expiry boolean not null default true,
  include_in_inspection boolean not null default true,
  replaces_id uuid unique references public.compliance_documents(id),
  version integer not null default 1,
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check (not watch_expiry or expires_on is not null)
);
create index compliance_documents_center_idx on public.compliance_documents(daycare_id, created_at desc);
alter table public.compliance_documents enable row level security;
create policy "admins read own compliance vault" on public.compliance_documents for select to authenticated
  using (public.is_admin() and daycare_id = public.get_my_daycare_id());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('compliance-vault','compliance-vault',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;
create policy "admins upload own compliance files" on storage.objects for insert to authenticated
  with check (bucket_id = 'compliance-vault' and public.is_admin()
    and split_part(name,'/',1) = public.get_my_daycare_id()::text
    and split_part(name,'/',2) = auth.uid()::text);
create policy "admins read own compliance files" on storage.objects for select to authenticated
  using (bucket_id = 'compliance-vault' and public.is_admin()
    and split_part(name,'/',1) = public.get_my_daycare_id()::text);
-- Only unattached uploads can be cleaned up. Stored originals are append-only.
create policy "admins remove unfinished compliance uploads" on storage.objects for delete to authenticated
  using (bucket_id = 'compliance-vault' and public.is_admin()
    and split_part(name,'/',1) = public.get_my_daycare_id()::text
    and split_part(name,'/',2) = auth.uid()::text
    and not exists (select 1 from public.compliance_documents d where d.storage_path = name));

create function public.save_compliance_document(p_title text,p_category text,p_storage_path text,
  p_expires_on date default null,p_watch_expiry boolean default false,
  p_include_in_inspection boolean default true,p_replaces_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare v_daycare uuid := public.get_my_daycare_id(); v_object record;
  v_previous public.compliance_documents; v_id uuid; v_version integer := 1;
begin
  if not coalesce(public.is_admin(),false) or v_daycare is null then raise exception 'Administrator access required'; end if;
  if split_part(p_storage_path,'/',1) <> v_daycare::text or split_part(p_storage_path,'/',2) <> auth.uid()::text then
    raise exception 'Upload this file to your own center first'; end if;
  select metadata into v_object from storage.objects where bucket_id = 'compliance-vault' and name = p_storage_path;
  if not found or coalesce(v_object.metadata->>'mimetype','') not in ('application/pdf','image/jpeg','image/png')
    or coalesce((v_object.metadata->>'size')::bigint,0) not between 1 and 10485760 then
    raise exception 'Upload a PDF, JPEG or PNG up to 10 MB'; end if;
  if p_replaces_id is not null then
    select * into v_previous from public.compliance_documents where id = p_replaces_id and daycare_id = v_daycare for update;
    if not found then raise exception 'Document not found'; end if;
    if exists (select 1 from public.compliance_documents where replaces_id = p_replaces_id) then
      raise exception 'A newer version already exists. Refresh and replace the current version'; end if;
    v_version := v_previous.version + 1;
  end if;
  insert into public.compliance_documents(daycare_id,title,category,storage_path,mime_type,size_bytes,
    expires_on,watch_expiry,include_in_inspection,replaces_id,version,uploaded_by)
  values(v_daycare,btrim(p_title),p_category,p_storage_path,v_object.metadata->>'mimetype',
    (v_object.metadata->>'size')::bigint,p_expires_on,p_watch_expiry,p_include_in_inspection,p_replaces_id,v_version,auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create table public.compliance_drills (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  kind text not null check (kind in ('fire','lockdown','severe_weather')),
  conducted_at timestamptz not null,
  lead_staff_id uuid not null references public.staff_members(id),
  duration_seconds integer not null check (duration_seconds between 1 and 86400),
  children_count integer not null check (children_count between 0 and 10000),
  staff_count integer not null check (staff_count between 1 and 10000),
  attendance_children integer not null,
  attendance_staff integer not null,
  notes text not null default '' check (length(notes) <= 4000),
  next_due_on date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  void_reason text,
  voided_at timestamptz
);
create index compliance_drills_center_idx on public.compliance_drills(daycare_id,conducted_at desc);
alter table public.compliance_drills enable row level security;
create policy "admins read own drills" on public.compliance_drills for select to authenticated
  using (public.is_admin() and daycare_id = public.get_my_daycare_id());

create function public.log_compliance_drill(p_kind text,p_conducted_local timestamp,p_lead_staff_id uuid,
  p_duration_seconds integer,p_children_count integer,p_staff_count integer,p_notes text default '',p_next_due_on date default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_daycare uuid := public.get_my_daycare_id(); v_time timestamptz; v_zone text;
  v_children integer; v_staff integer; v_id uuid;
begin
  if not coalesce(public.is_admin(),false) or v_daycare is null then raise exception 'Administrator access required'; end if;
  select coalesce(timezone,'UTC') into v_zone from public.daycares where id = v_daycare;
  v_time := p_conducted_local at time zone v_zone;
  if v_time is null or v_time > now() then raise exception 'The drill must have already taken place'; end if;
  if p_next_due_on is not null and p_next_due_on <= p_conducted_local::date then
    raise exception 'The next drill must be after this drill'; end if;
  if not exists (select 1 from public.staff_members where id = p_lead_staff_id and daycare_id = v_daycare
    and archived_at is null and status <> 'inactive') then raise exception 'Choose an active staff lead from this center'; end if;
  select count(distinct child_id) into v_children from public.attendance_records
    where daycare_id = v_daycare and checked_in_at <= v_time and (checked_out_at is null or checked_out_at > v_time)
      and date = p_conducted_local::date and status in ('present','late');
  select count(distinct staff_member_id) into v_staff from public.staff_time_entries
    where daycare_id = v_daycare and clocked_in_at <= v_time and (clocked_out_at is null or clocked_out_at > v_time)
      and status <> 'void';
  if (p_children_count <> v_children or p_staff_count <> v_staff) and length(btrim(coalesce(p_notes,''))) < 5 then
    raise exception 'Headcounts differ from attendance (% children, % clocked-in staff). Add a note explaining the difference',v_children,v_staff; end if;
  insert into public.compliance_drills(daycare_id,kind,conducted_at,lead_staff_id,duration_seconds,children_count,staff_count,
    attendance_children,attendance_staff,notes,next_due_on,created_by)
  values(v_daycare,p_kind,v_time,p_lead_staff_id,p_duration_seconds,p_children_count,p_staff_count,
    v_children,v_staff,btrim(coalesce(p_notes,'')),p_next_due_on,auth.uid()) returning id into v_id;
  return v_id;
end $$;

create function public.void_compliance_drill(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Explain the correction (5–500 characters)'; end if;
  update public.compliance_drills set void_reason = btrim(p_reason),voided_at = now()
    where id = p_id and daycare_id = public.get_my_daycare_id() and voided_at is null;
  if not found then raise exception 'Drill not found or already voided'; end if;
end $$;
create trigger audit_compliance_documents after insert on public.compliance_documents for each row execute function public.audit_write();
create trigger audit_compliance_drills after insert or update on public.compliance_drills for each row execute function public.audit_write();

-- Shared packs deliberately contain only inspection-relevant fields, never
-- medical narratives, contact details, credentials secrets or raw storage paths.
create function public._compliance_inspection_pack(p_daycare uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_today date; v_zone text; v_name text;
begin
  select coalesce(timezone,'UTC'),name into v_zone,v_name from public.daycares where id = p_daycare;
  v_today := (now() at time zone v_zone)::date;
  return jsonb_build_object('center_name',v_name,'timezone',v_zone,'today',v_today,'generated_at',now(),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'category',d.category,
      'expires_on',d.expires_on,'version',d.version,'created_at',d.created_at) order by d.title)
      from public.compliance_documents d where d.daycare_id = p_daycare and d.include_in_inspection
      and not exists(select 1 from public.compliance_documents n where n.replaces_id = d.id)),'[]'::jsonb),
    'drills',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'conducted_at',d.conducted_at,
      'lead_name',p.full_name,'duration_seconds',d.duration_seconds,'children_count',d.children_count,'staff_count',d.staff_count,
      'attendance_children',d.attendance_children,'attendance_staff',d.attendance_staff,'notes',d.notes,'next_due_on',d.next_due_on,
      'voided_at',d.voided_at,'void_reason',d.void_reason) order by d.conducted_at desc)
      from public.compliance_drills d join public.staff_members sm on sm.id = d.lead_staff_id
      left join public.profiles p on p.id = sm.profile_id
      where d.daycare_id = p_daycare and d.conducted_at >= (v_today - interval '12 months') at time zone v_zone),'[]'::jsonb),
    'staff',coalesce((select jsonb_agg(jsonb_build_object('id',sm.id,'name',p.full_name,'status',sm.status,
      'credentials',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'required',c.required,
        'completed_on',c.completed_on,'expires_on',c.expires_on,'document_id',c.document_id,
        'pending_review',exists(select 1 from public.staff_credential_submissions s where s.credential_id=c.id and s.status='pending')) order by c.name)
        from public.staff_credentials c where c.staff_member_id=sm.id and c.archived_at is null),'[]'::jsonb)) order by p.full_name)
      from public.staff_members sm join public.profiles p on p.id = sm.profile_id
      where sm.daycare_id=p_daycare and sm.archived_at is null and sm.status <> 'inactive'),'[]'::jsonb),
    'attendance',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'child_name',ch.first_name||' '||ch.last_name,
      'room',cl.name,'checked_in_at',a.checked_in_at,'checked_out_at',a.checked_out_at,'status',a.status,
      'dropped_off_by',a.dropped_off_by,'picked_up_by',a.picked_up_by) order by cl.name,ch.first_name)
      from public.attendance_records a join public.children ch on ch.id=a.child_id left join public.classrooms cl on cl.id=ch.classroom_id
      where a.daycare_id=p_daycare and a.date=v_today),'[]'::jsonb),
    'ratio_events',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'room',cl.name,'started_at',r.started_at,
      'resolved_at',r.resolved_at,'peak_present',r.peak_present,'minimum_staff',r.minimum_staff,'required_staff',r.required_staff) order by r.started_at desc)
      from public.room_ratio_events r join public.classrooms cl on cl.id=r.classroom_id
      where r.daycare_id=p_daycare and (r.started_at >= (v_today-90)::timestamp at time zone v_zone or r.resolved_at is null)),'[]'::jsonb),
    'incidents',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'child_name',ch.first_name||' '||ch.last_name,
      'occurred_at',i.occurred_at,'severity',i.severity,'status',i.status,'signed_off_at',i.signed_off_at,
      'parent_acknowledged_at',i.parent_acknowledged_at) order by i.occurred_at desc)
      from public.incident_reports i join public.children ch on ch.id=i.child_id
      where i.daycare_id=p_daycare and i.status <> 'draft' and i.occurred_at >= (v_today-interval '12 months') at time zone v_zone),'[]'::jsonb),
    'menu_days', (select count(distinct menu_date) from public.meal_menu_items where daycare_id=p_daycare and menu_date between v_today-29 and v_today));
end $$;

create function public.get_compliance_inspection_pack()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required'; end if;
  return public._compliance_inspection_pack(public.get_my_daycare_id());
end $$;

create table public.compliance_inspection_shares (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  token_hash text not null unique,
  label text not null check (length(btrim(label)) between 1 and 120),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '48 hours',
  revoked_at timestamptz,
  last_opened_at timestamptz
);
alter table public.compliance_inspection_shares enable row level security;
-- No direct SELECT: even admins receive only safe metadata from the list RPC.
create function public.create_compliance_inspection_share(p_label text)
returns jsonb language plpgsql security definer set search_path = public,extensions as $$
declare v_token text := encode(gen_random_bytes(32),'hex'); v_id uuid; v_expiry timestamptz := now()+interval '48 hours';
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required'; end if;
  insert into public.compliance_inspection_shares(daycare_id,token_hash,label,created_by,expires_at)
    values(public.get_my_daycare_id(),encode(digest(v_token,'sha256'),'hex'),btrim(p_label),auth.uid(),v_expiry) returning id into v_id;
  insert into public.audit_log(daycare_id,actor_id,action,entity_type,entity_id,after)
    values(public.get_my_daycare_id(),auth.uid(),'share_created','compliance_inspection_shares',v_id,
      jsonb_build_object('label',btrim(p_label),'expires_at',v_expiry));
  return jsonb_build_object('id',v_id,'token',v_token,'expires_at',v_expiry);
end $$;
create function public.list_compliance_inspection_shares()
returns table(id uuid,label text,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz,last_opened_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id,s.label,s.created_at,s.expires_at,s.revoked_at,s.last_opened_at
    from public.compliance_inspection_shares s where public.is_admin() and s.daycare_id=public.get_my_daycare_id()
    order by s.created_at desc limit 50;
$$;
create function public.revoke_compliance_inspection_share(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.is_admin(),false) then raise exception 'Administrator access required'; end if;
  update public.compliance_inspection_shares set revoked_at=now() where id=p_id and daycare_id=public.get_my_daycare_id() and revoked_at is null;
  if not found then raise exception 'Share not found or already revoked'; end if;
  insert into public.audit_log(daycare_id,actor_id,action,entity_type,entity_id)
    values(public.get_my_daycare_id(),auth.uid(),'share_revoked','compliance_inspection_shares',p_id);
end $$;

create function public.read_compliance_inspection_share(p_token text,p_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public,extensions as $$
declare v_share public.compliance_inspection_shares; v_document jsonb;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'This inspection link is unavailable or expired'; end if;
  select * into v_share from public.compliance_inspection_shares where token_hash=encode(digest(p_token,'sha256'),'hex')
    and revoked_at is null and expires_at > now();
  if not found then raise exception 'This inspection link is unavailable or expired'; end if;
  if p_document_id is not null then
    select jsonb_build_object('title',d.title,'storage_path',d.storage_path,'mime_type',d.mime_type) into v_document
      from public.compliance_documents d where d.id=p_document_id and d.daycare_id=v_share.daycare_id and d.include_in_inspection
      and not exists(select 1 from public.compliance_documents n where n.replaces_id=d.id);
    if v_document is null then raise exception 'Document is not included in this inspection pack'; end if;
  end if;
  update public.compliance_inspection_shares set last_opened_at=now() where id=v_share.id;
  insert into public.audit_log(daycare_id,action,entity_type,entity_id,after)
    values(v_share.daycare_id,case when p_document_id is null then 'share_opened' else 'share_document_opened' end,
      'compliance_inspection_shares',v_share.id,jsonb_build_object('document_id',p_document_id));
  if p_document_id is not null then return v_document; end if;
  return public._compliance_inspection_pack(v_share.daycare_id)||jsonb_build_object('share_label',v_share.label,'share_expires_at',v_share.expires_at);
end $$;

revoke all on function public._compliance_inspection_pack(uuid) from public,anon,authenticated;
revoke all on function public.save_compliance_document(text,text,text,date,boolean,boolean,uuid) from public,anon;
revoke all on function public.log_compliance_drill(text,timestamp,uuid,integer,integer,integer,text,date) from public,anon;
revoke all on function public.void_compliance_drill(uuid,text) from public,anon;
revoke all on function public.get_compliance_inspection_pack() from public,anon;
revoke all on function public.create_compliance_inspection_share(text) from public,anon;
revoke all on function public.list_compliance_inspection_shares() from public,anon;
revoke all on function public.revoke_compliance_inspection_share(uuid) from public,anon;
revoke all on function public.read_compliance_inspection_share(text,uuid) from public;
grant execute on function public.save_compliance_document(text,text,text,date,boolean,boolean,uuid),
  public.log_compliance_drill(text,timestamp,uuid,integer,integer,integer,text,date),public.void_compliance_drill(uuid,text),
  public.get_compliance_inspection_pack(),public.create_compliance_inspection_share(text),
  public.list_compliance_inspection_shares(),public.revoke_compliance_inspection_share(uuid) to authenticated;
grant execute on function public.read_compliance_inspection_share(text,uuid) to anon,authenticated,service_role;
