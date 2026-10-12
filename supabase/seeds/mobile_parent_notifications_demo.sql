-- Resettable parent notification-inbox and deep-link demo.
-- Login: lucia.castillo@parent.test / password123

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
begin
  if not exists (
    select 1 from public.parent_children
    where parent_id = v_parent and child_id = v_child
  ) then
    raise notice 'Skipping parent notification demo: Lucia and Mateo are not seeded';
    return;
  end if;

  insert into public.notifications (
    id, daycare_id, profile_id, kind, title, body, payload, read_at, created_at
  ) values
    (
      '42900000-0000-4000-a000-000000000001', v_daycare, v_parent,
      'parent_document_request',
      'Updated record requested for Mateo',
      'Please upload Mateo''s latest immunization record. A clear photo is perfect.',
      jsonb_build_object(
        'screen', 'ParentDocumentUpload',
        'requestId', '42810000-0000-4000-a000-000000000001',
        'childId', v_child,
        'category', 'documents'
      ),
      null, now() - interval '9 minutes'
    ),
    (
      '42900000-0000-4000-a000-000000000002', v_daycare, v_parent,
      'parent_schedule',
      'Center closed tomorrow',
      'Sunny Grove is closed for staff professional development. Tap for reopening and billing details.',
      jsonb_build_object(
        'screen', 'ParentClosureNotice',
        'type', 'center_closure_reminder',
        'closureId', '42700000-0000-4000-a000-000000000001',
        'childId', v_child
      ),
      null, now() - interval '2 hours'
    ),
    (
      '42900000-0000-4000-a000-000000000003', v_daycare, v_parent,
      'parent_billing',
      'August tuition is ready',
      '$1,240.00 is due. Review the invoice and your saved test payment method.',
      jsonb_build_object(
        'screen', 'ParentInvoice',
        'invoiceId', '52000000-0000-4000-a000-000000000001',
        'childId', v_child
      ),
      null, now() - interval '6 hours'
    ),
    (
      '42900000-0000-4000-a000-000000000004', v_daycare, v_parent,
      'announcement',
      'Family picnic RSVP',
      'Let the center know how many family members are coming.',
      jsonb_build_object(
        'screen', 'EventDetail',
        'announcementId', '82000000-0000-4000-a000-000000000001',
        'childId', v_child
      ),
      now() - interval '20 hours', now() - interval '1 day 2 hours'
    ),
    (
      '42900000-0000-4000-a000-000000000005', v_daycare, v_parent,
      'daily_log',
      'Mateo''s daily log is ready',
      'Meals, rest and today''s classroom moments are ready to view.',
      jsonb_build_object(
        'screen', 'ParentHome',
        'type', 'daily_log',
        'childId', v_child,
        'logDate', '2026-07-16'
      ),
      now() - interval '2 days', now() - interval '2 days 3 hours'
    )
  on conflict (id) do update set
    kind = excluded.kind,
    title = excluded.title,
    body = excluded.body,
    payload = excluded.payload,
    read_at = excluded.read_at,
    created_at = excluded.created_at;
end;
$$;
