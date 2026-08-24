-- Parent Mobile Group 28 document-vault workflow and isolation tests.
-- Requires the standard demo seed and Group 28 demo seed. Every mutation rolls back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_admin constant uuid := '00000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_foreign_child constant uuid := '30000000-0000-4000-a000-000000000002';
  v_foreign_daycare constant uuid := '42890000-0000-4000-a000-000000000001';
  v_cross_center_child constant uuid := '42890000-0000-4000-a000-000000000002';
  v_request constant uuid := '42810000-0000-4000-a000-000000000001';
  v_hub jsonb;
  v_created jsonb;
  v_submitted jsonb;
  v_reviewed jsonb;
  v_foreign_request jsonb;
  v_path text;
  v_orphan_path text;
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('authenticated', v_parent);
  v_hub := public.get_parent_documents_hub();
  if jsonb_array_length(v_hub->'children') < 1
     or not jsonb_path_exists(v_hub, '$.children[*].records[*] ? (@.source_type == "agreement")')
     or not jsonb_path_exists(v_hub, '$.children[*].records[*] ? (@.source_type == "application_summary")')
     or not jsonb_path_exists(v_hub, '$.children[*].requests[*] ? (@.id == "42810000-0000-4000-a000-000000000001")') then
    raise exception 'FAIL: parent document hub is incomplete: %', v_hub;
  end if;
  raise notice 'PASS: hub combines requests, signed agreement, application, and health records';

  v_failed := false;
  begin
    update public.parent_document_requests set status = 'accepted' where id = v_request;
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent bypassed the audited submission workflow'; end if;
  raise notice 'PASS: parents cannot directly mutate request review state';

  perform pg_temp.impersonate('authenticated', v_admin);
  v_created := public.create_parent_document_request(
    v_child,
    'custody_update',
    'Updated custody authorization',
    'Please upload the current authorization if family pickup permissions have changed.',
    current_date + 14
  );
  if v_created->>'id' is null or v_created->>'status' <> 'requested' then
    raise exception 'FAIL: administrator request was not created: %', v_created;
  end if;
  v_foreign_request := public.create_parent_document_request(
    v_foreign_child, 'medical_update', 'Updated medical form', null, current_date + 10
  );
  raise notice 'PASS: administrators can create persistent post-enrollment requests';

  v_path := 'parent-documents/10000000-0000-4000-a000-000000000001/' ||
    v_child::text || '/' || v_request::text || '/' || v_parent::text || '/group28-test.pdf';
  perform pg_temp.impersonate('postgres');
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (
    'documents', v_path, v_parent, v_parent::text,
    jsonb_build_object('mimetype', 'application/pdf', 'size', 2048)
  );

  v_orphan_path := 'parent-documents/10000000-0000-4000-a000-000000000001/' ||
    v_child::text || '/' || v_request::text || '/' || v_parent::text || '/orphan.pdf';
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values (
    'documents', v_orphan_path, v_parent, v_parent::text,
    jsonb_build_object('mimetype', 'application/pdf', 'size', 1024)
  );

  perform pg_temp.impersonate('authenticated', v_parent);
  if public.can_read_parent_document_object(v_orphan_path) then
    raise exception 'FAIL: unreferenced storage object was family-readable';
  end if;
  if not public.can_delete_unreferenced_parent_document(v_orphan_path) then
    raise exception 'FAIL: uploader cannot clean up an unreferenced object';
  end if;
  raise notice 'PASS: storage reads require a record and failed uploads remain removable';

  v_submitted := public.submit_parent_document_request(
    v_request, v_path, 'mateo-immunization.pdf', 'application/pdf', 2048
  );
  if v_submitted->>'status' <> 'under_review'
     or v_submitted->>'submission_id' is null
     or v_submitted->>'document_id' is null then
    raise exception 'FAIL: valid parent upload was not attached to the request: %', v_submitted;
  end if;
  if not public.can_read_parent_document_object(v_path)
     or public.can_delete_unreferenced_parent_document(v_path) then
    raise exception 'FAIL: referenced family document storage rules are incorrect';
  end if;
  raise notice 'PASS: requested upload creates a private document and review submission';

  perform pg_temp.impersonate('authenticated', v_admin);
  perform pg_temp.impersonate('postgres');
  insert into public.daycares (id, name, created_by)
  values (v_foreign_daycare, 'Group 28 isolation center', null);
  insert into public.children (id, daycare_id, first_name, last_name)
  values (v_cross_center_child, v_foreign_daycare, 'Isolation', 'Child');

  perform pg_temp.impersonate('authenticated', v_admin);
  v_failed := false;
  begin
    insert into public.parent_document_requests (
      daycare_id, child_id, kind, title, requested_by
    ) values (
      '10000000-0000-4000-a000-000000000001',
      v_cross_center_child,
      'invalid_cross_center',
      'Invalid cross-center request',
      v_admin
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: cross-center child request was accepted'; end if;
  raise notice 'PASS: request relationship guard rejects a cross-center child';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.submit_parent_document_request(
      (v_foreign_request->>'id')::uuid,
      'parent-documents/blocked/blocked/blocked/blocked/file.pdf',
      'blocked.pdf', 'application/pdf', 100
    );
  exception when others then
    v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: parent submitted a document for another family'; end if;
  raise notice 'PASS: cross-family request submission is rejected';

  perform pg_temp.impersonate('authenticated', v_admin);
  v_reviewed := public.review_parent_document_submission(
    (v_submitted->>'submission_id')::uuid, 'accepted', null
  );
  if v_reviewed->>'status' <> 'accepted' then
    raise exception 'FAIL: administrator review did not complete request: %', v_reviewed;
  end if;

  perform pg_temp.impersonate('authenticated', v_parent);
  v_hub := public.get_parent_documents_hub();
  if not jsonb_path_exists(v_hub, '$.children[*].records[*] ? (@.title == "Updated immunization record" && @.status == "accepted")') then
    raise exception 'FAIL: accepted file did not move into the standing vault: %', v_hub;
  end if;
  raise notice 'PASS: accepted submissions become downloadable standing records';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 28 TESTS: ALL PASSED' as result;
