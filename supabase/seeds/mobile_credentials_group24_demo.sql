-- Group 24 mobile demo data for Maria Kowalski at Sunny Grove.
-- Covers valid, expiring, missing, pending-review and rejected/resubmit states.

do $$
declare
  v_daycare uuid;
  v_member uuid;
  v_maria uuid;
  v_admin uuid;
  v_today date;
  v_first_aid uuid := '62400000-0000-4000-a000-000000000001';
  v_background uuid := '62400000-0000-4000-a000-000000000002';
  v_immunization uuid := '62400000-0000-4000-a000-000000000003';
  v_tb uuid := '62400000-0000-4000-a000-000000000004';
  v_food uuid := '62400000-0000-4000-a000-000000000005';
  v_rejected_doc uuid := '62410000-0000-4000-a000-000000000001';
  v_pending_doc uuid := '62410000-0000-4000-a000-000000000002';
begin
  select member.daycare_id, member.id, member.profile_id
    into v_daycare, v_member, v_maria
    from public.staff_members member
    join public.profiles profile on profile.id = member.profile_id
   where lower(profile.email) = 'maria@sunnygrove.test'
     and member.status = 'active'
     and member.archived_at is null
   limit 1;
  if v_member is null then
    raise exception 'Maria Kowalski seed staff record was not found';
  end if;

  select profile.id into v_admin
    from public.profiles profile
   where profile.daycare_id = v_daycare
     and profile.role in ('owner_admin', 'admin')
     and profile.archived_at is null
   order by case when profile.role = 'owner_admin' then 0 else 1 end, profile.created_at
   limit 1;
  v_today := public.center_today();

  delete from public.staff_credentials credential
   where credential.staff_member_id = v_member
     and credential.id not in (
       v_first_aid, v_background, v_immunization, v_tb, v_food
     );

  insert into public.staff_credentials (
    id, daycare_id, staff_member_id, name, issuer, completed_on, expires_on,
    credential_number, required, ratio_qualifying
  ) values
    (v_first_aid, v_daycare, v_member, 'First Aid / CPR', 'Canadian Red Cross',
     v_today - 718, v_today + 12, 'RC-8841-22', true, true),
    (v_background, v_daycare, v_member, 'Criminal record check', 'York Regional Police',
     v_today - 155, v_today + 210, 'VSC-2026-1047', true, false),
    (v_immunization, v_daycare, v_member, 'Immunization record', 'Dr. A. Patel',
     v_today - 420, null, null, true, false),
    (v_tb, v_daycare, v_member, 'TB test', null, null, null, null, true, false),
    (v_food, v_daycare, v_member, 'Food Handler Certificate', 'YorkSafe Training',
     v_today - 350, v_today + 15, 'FH-11482', true, false)
  on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    staff_member_id = excluded.staff_member_id,
    name = excluded.name,
    issuer = excluded.issuer,
    completed_on = excluded.completed_on,
    expires_on = excluded.expires_on,
    credential_number = excluded.credential_number,
    required = excluded.required,
    ratio_qualifying = excluded.ratio_qualifying;

  update public.staff_credentials credential
     set archived_at = null
   where credential.id in (v_first_aid, v_background, v_immunization, v_tb, v_food);

  insert into public.documents (
    id, daycare_id, profile_id, title, category, storage_path, mime_type,
    size_bytes, expires_on, uploaded_by
  ) values
    (v_rejected_doc, v_daycare, v_maria, 'tb-test-photo.jpg',
     'staff_credential_renewal',
     'staff-credentials/' || v_daycare || '/' || v_maria || '/demo/tb-test-photo.jpg',
     'image/jpeg', 428311, v_today + 365, v_maria),
    (v_pending_doc, v_daycare, v_maria, 'food-handler-renewal.pdf',
     'staff_credential_renewal',
     'staff-credentials/' || v_daycare || '/' || v_maria || '/demo/food-handler-renewal.pdf',
     'application/pdf', 782144, v_today + 1095, v_maria)
  on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    profile_id = excluded.profile_id,
    title = excluded.title,
    category = excluded.category,
    storage_path = excluded.storage_path,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    expires_on = excluded.expires_on,
    uploaded_by = excluded.uploaded_by;

  insert into public.staff_credential_submissions (
    id, daycare_id, staff_member_id, credential_id, document_id, submitted_by,
    issuer, completed_on, expires_on, status, review_notes, reviewed_by,
    reviewed_at, created_at, updated_at
  ) values
    ('62420000-0000-4000-a000-000000000001', v_daycare, v_member, v_tb,
     v_rejected_doc, v_maria, 'Walk-in Clinic', v_today - 4, v_today + 365,
     'rejected', 'Please upload the full report. The result and clinic stamp are cut off.',
     v_admin, now() - interval '2 days', now() - interval '3 days', now() - interval '2 days'),
    ('62420000-0000-4000-a000-000000000002', v_daycare, v_member, v_food,
     v_pending_doc, v_maria, 'YorkSafe Training', v_today - 1, v_today + 1095,
     'pending', null, null, null, now() - interval '3 hours', now() - interval '3 hours')
  on conflict (id) do update set
    daycare_id = excluded.daycare_id,
    staff_member_id = excluded.staff_member_id,
    credential_id = excluded.credential_id,
    document_id = excluded.document_id,
    submitted_by = excluded.submitted_by,
    issuer = excluded.issuer,
    completed_on = excluded.completed_on,
    expires_on = excluded.expires_on,
    status = excluded.status,
    review_notes = excluded.review_notes,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at;

  perform public.sync_staff_certifications_json(v_member);
end;
$$;
