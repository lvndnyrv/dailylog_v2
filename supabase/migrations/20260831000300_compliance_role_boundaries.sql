-- Inspection bundles must not bypass a custom admin role's source permissions.
create function public._compliance_profile_access(p_profile uuid,p_daycare uuid,p_write boolean)
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce((select p.role='owner_admin' or (p.role='admin'
    and coalesce(r.permissions#>>'{staff,view}','true')='true'
    and coalesce(r.permissions#>>'{incidents,view}','true')='true'
    and coalesce(r.permissions#>>'{attendance,view}','true')='true'
    and coalesce(r.permissions#>>'{reports,view}','true')='true'
    and (not p_write or coalesce(r.permissions#>>'{reports,edit}','true')='true'))
    from public.profiles p left join public.center_roles r on r.id=p.center_role_id and r.daycare_id=p.daycare_id
    where p.id=p_profile and p.daycare_id=p_daycare and p.archived_at is null),false);
$$;
create function public.can_access_compliance(p_write boolean default false)
returns boolean language sql stable security definer set search_path=public as $$
  select public._compliance_profile_access(auth.uid(),public.get_my_daycare_id(),p_write);
$$;
revoke all on function public._compliance_profile_access(uuid,uuid,boolean) from public,anon,authenticated;
revoke all on function public.can_access_compliance(boolean) from public,anon;
grant execute on function public.can_access_compliance(boolean) to authenticated;

alter policy "admins read own compliance vault" on public.compliance_documents
  using (public.can_access_compliance() and daycare_id=public.get_my_daycare_id());
alter policy "admins read own drills" on public.compliance_drills
  using (public.can_access_compliance() and daycare_id=public.get_my_daycare_id());
alter policy "admins upload own compliance files" on storage.objects with check
  (bucket_id='compliance-vault' and public.can_access_compliance(true)
    and split_part(name,'/',1)=public.get_my_daycare_id()::text and split_part(name,'/',2)=auth.uid()::text);
alter policy "admins read own compliance files" on storage.objects using
  (bucket_id='compliance-vault' and public.can_access_compliance()
    and split_part(name,'/',1)=public.get_my_daycare_id()::text);
alter policy "admins remove unfinished compliance uploads" on storage.objects using
  (bucket_id='compliance-vault' and public.can_access_compliance(true)
    and split_part(name,'/',1)=public.get_my_daycare_id()::text and split_part(name,'/',2)=auth.uid()::text
    and not exists(select 1 from public.compliance_documents d where d.storage_path=name));

-- Keep the tested implementations internal and expose permission-checked RPCs.
alter function public.save_compliance_document(text,text,text,date,boolean,boolean,uuid) rename to _save_compliance_document;
alter function public.log_compliance_drill(text,timestamp,uuid,integer,integer,integer,text,date) rename to _log_compliance_drill;
alter function public.void_compliance_drill(uuid,text) rename to _void_compliance_drill;
alter function public.create_compliance_inspection_share(text) rename to _create_compliance_inspection_share;
alter function public.revoke_compliance_inspection_share(uuid) rename to _revoke_compliance_inspection_share;
alter function public.read_compliance_inspection_share(text,uuid) rename to _read_compliance_inspection_share;
revoke all on function public._save_compliance_document(text,text,text,date,boolean,boolean,uuid),
  public._log_compliance_drill(text,timestamp,uuid,integer,integer,integer,text,date),public._void_compliance_drill(uuid,text),
  public._create_compliance_inspection_share(text),public._revoke_compliance_inspection_share(uuid),
  public._read_compliance_inspection_share(text,uuid) from public,anon,authenticated,service_role;

create function public.save_compliance_document(p_title text,p_category text,p_storage_path text,p_expires_on date default null,
  p_watch_expiry boolean default false,p_include_in_inspection boolean default true,p_replaces_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  if not public.can_access_compliance(true) then raise exception 'Compliance editing requires an active admin with staff, incidents, attendance and report access'; end if;
  return public._save_compliance_document(p_title,p_category,p_storage_path,p_expires_on,p_watch_expiry,p_include_in_inspection,p_replaces_id);
end $$;
create function public.log_compliance_drill(p_kind text,p_conducted_local timestamp,p_lead_staff_id uuid,
  p_duration_seconds integer,p_children_count integer,p_staff_count integer,p_notes text default '',p_next_due_on date default null)
returns uuid language plpgsql security definer set search_path=public as $$
begin
  if not public.can_access_compliance(true) then raise exception 'Compliance editing permission required'; end if;
  return public._log_compliance_drill(p_kind,p_conducted_local,p_lead_staff_id,p_duration_seconds,p_children_count,p_staff_count,p_notes,p_next_due_on);
end $$;
create function public.void_compliance_drill(p_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_access_compliance(true) then raise exception 'Compliance editing permission required'; end if;
  perform public._void_compliance_drill(p_id,p_reason);
end $$;
create or replace function public.get_compliance_inspection_pack()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
  if not public.can_access_compliance() then raise exception 'Compliance requires an active admin with staff, incidents, attendance and report access'; end if;
  return public._compliance_inspection_pack(public.get_my_daycare_id());
end $$;
create function public.create_compliance_inspection_share(p_label text)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  if not public.can_access_compliance(true) then raise exception 'Compliance sharing permission required'; end if;
  return public._create_compliance_inspection_share(p_label);
end $$;
create function public.revoke_compliance_inspection_share(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.can_access_compliance(true) then raise exception 'Compliance sharing permission required'; end if;
  perform public._revoke_compliance_inspection_share(p_id);
end $$;
create or replace function public.list_compliance_inspection_shares()
returns table(id uuid,label text,created_at timestamptz,expires_at timestamptz,revoked_at timestamptz,last_opened_at timestamptz)
language sql stable security definer set search_path=public as $$
  select s.id,s.label,s.created_at,s.expires_at,s.revoked_at,s.last_opened_at from public.compliance_inspection_shares s
    where public.can_access_compliance() and s.daycare_id=public.get_my_daycare_id() order by s.created_at desc limit 50;
$$;
create or replace function public.list_compliance_due_items()
returns table(id uuid,title text,due_on date,kind text,days_left integer)
language sql stable security definer set search_path=public as $$
  select d.* from public._compliance_due_items(public.get_my_daycare_id()) d
    where public.can_access_compliance() order by d.due_on,d.title;
$$;
create function public.read_compliance_inspection_share(p_token text,p_document_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or not exists(
    select 1 from public.compliance_inspection_shares s where s.token_hash=encode(digest(p_token,'sha256'),'hex')
      and s.revoked_at is null and s.expires_at>now()
      and public._compliance_profile_access(s.created_by,s.daycare_id,true)
  ) then raise exception 'This inspection link is unavailable or expired'; end if;
  return public._read_compliance_inspection_share(p_token,p_document_id);
end $$;
revoke all on function public.save_compliance_document(text,text,text,date,boolean,boolean,uuid),
  public.log_compliance_drill(text,timestamp,uuid,integer,integer,integer,text,date),public.void_compliance_drill(uuid,text),
  public.create_compliance_inspection_share(text),public.revoke_compliance_inspection_share(uuid) from public,anon;
revoke all on function public.read_compliance_inspection_share(text,uuid) from public;
grant execute on function public.save_compliance_document(text,text,text,date,boolean,boolean,uuid),
  public.log_compliance_drill(text,timestamp,uuid,integer,integer,integer,text,date),public.void_compliance_drill(uuid,text),
  public.create_compliance_inspection_share(text),public.revoke_compliance_inspection_share(uuid) to authenticated;
grant execute on function public.read_compliance_inspection_share(text,uuid) to anon,authenticated,service_role;
