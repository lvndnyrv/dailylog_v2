-- Resettable Parent Mobile Group 24 demo offer.
-- Deep link: dailylog://offer?code=PARENT24-MIA-2026

do $$
declare
  v_enrollment constant uuid := '41000000-0000-4000-a000-000000000001';
  v_child uuid;
begin
  select child_id into v_child from public.enrollments where id = v_enrollment;

  delete from public.notification_outbox outbox
  where outbox.dedupe_key in (
    select 'parent-enrollment-receipt:' || payment.id
    from public.enrollment_offer_payments payment
    where payment.enrollment_id = v_enrollment
  );
  delete from public.enrollment_offer_payments where enrollment_id = v_enrollment;
  delete from public.enrollment_agreement_signatures where enrollment_id = v_enrollment;
  update public.enrollments
  set child_id = null,
      child_first_name = 'Mia',
      child_last_name = 'Baker',
      child_date_of_birth = date '2025-07-18',
      guardian_name = 'Olivia Baker',
      guardian_email = 'olivia.baker@family.test',
      guardian_phone = '416-555-0201',
      offer_code = 'PARENT24-MIA-2026',
      offer_sent_at = now(),
      offer_viewed_at = null,
      offer_expires_at = now() + interval '7 days',
      offer_status = 'sent',
      offer_accepted_at = null,
      offer_declined_at = null,
      offer_decline_reason = null,
      parent_workflow_step = 'offer',
      application_data = jsonb_build_object(
        'child_full_name', 'Mia Baker',
        'child_date_of_birth', '2025-07-18',
        'allergies', jsonb_build_array('Egg'),
        'primary_guardian_name', 'Olivia Baker',
        'primary_guardian_email', 'olivia.baker@family.test',
        'primary_guardian_phone', '416-555-0201',
        'co_guardian_name', 'Noah Baker',
        'co_guardian_email', 'noah.baker@family.test',
        'emergency_contact_name', 'Ava Baker',
        'emergency_contact_phone', '416-555-0202'
      ),
      documents_status = coalesce((
        select jsonb_object_agg(document.kind, 'received')
        from public.enrollment_application_documents document
        where document.enrollment_id = v_enrollment
      ), '{}'::jsonb),
      application_progress = 0,
      application_submitted_at = null,
      agreement_version = null,
      agreement_data = '{}'::jsonb,
      agreement_signed_at = null,
      deposit_status = 'unpaid',
      deposit_paid_at = null,
      deposit_payment_id = null,
      payment_mode = 'demo',
      parent_account_linked_at = null,
      stage = 'offer',
      stage_changed_at = now(),
      waitlist_status = 'offer',
      offer_deposit_cents = 50000,
      offer_tuition_cents = 128000,
      desired_start_date = current_date + 28,
      onboarding_steps = '{}'::jsonb
  where id = v_enrollment;

  if v_child is not null
     and not exists (select 1 from public.enrollments where child_id = v_child)
     and not exists (select 1 from public.parent_children where child_id = v_child) then
    delete from public.children where id = v_child;
  end if;
end;
$$;
