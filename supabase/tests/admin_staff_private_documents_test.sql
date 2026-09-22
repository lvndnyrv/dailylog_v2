-- Group 4b invariant: HR files are visible and manageable only by the owner,
-- even when another administrator or the staff subject knows the record ID.

begin;

do $$
declare
  v_document uuid := gen_random_uuid();
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_admin uuid := '00000000-0000-4000-a000-000000000002';
  v_educator uuid := '00000000-0000-4000-a000-000000000007';
begin
  insert into public.documents (
    id, daycare_id, profile_id, title, category, storage_path, mime_type, uploaded_by
  ) values (
    v_document,
    '10000000-0000-4000-a000-000000000001',
    v_educator,
    'Private staff document test',
    'staff_private_other',
    'staff-private/test/private-document.pdf',
    'application/pdf',
    v_owner
  );

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  if not exists (select 1 from public.documents where id = v_document) then
    raise exception 'FAIL: owner could not read the private staff file';
  end if;
  update public.documents set archived_at = now() where id = v_document;

  reset role;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  if exists (select 1 from public.documents where id = v_document) then
    raise exception 'FAIL: delegated administrator read the private staff file';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', v_educator::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  if exists (select 1 from public.documents where id = v_document) then
    raise exception 'FAIL: staff subject read the owner-only HR file';
  end if;

  reset role;
  if not exists (
    select 1 from public.audit_log audit
     where audit.entity_type = 'documents'
       and audit.entity_id = v_document
       and audit.actor_id = v_owner
       and audit.action = 'update'
  ) then
    raise exception 'FAIL: private document archive was not audited';
  end if;

  raise notice 'PASS: owner-only visibility, management, and audit trail are intact';
end;
$$;

rollback;
