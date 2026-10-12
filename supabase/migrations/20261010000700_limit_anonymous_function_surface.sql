-- Supabase's project defaults granted every newly created function directly
-- to anon. Most DailyLog RPCs perform their own authorization, but they should
-- not be reachable before sign-in at all. Remove that inherited exposure and
-- retain only policy helpers plus intentionally public onboarding/share flows.

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

do $$
declare
  v_function record;
  v_anonymous_names constant text[] := array[
    -- RLS and Storage policy helpers. These inspect only auth.uid() and fail
    -- closed when there is no authenticated profile.
    'can_access_billing_family',
    'can_access_child',
    'can_access_child_area',
    'can_access_compliance',
    'can_access_family',
    'can_access_log_area',
    'can_delete_unreferenced_parent_document',
    'can_manage_daily_log_photo_object',
    'can_read_parent_document_object',
    'can_upload_parent_enrollment_document',
    'can_upload_parent_requested_document',
    'can_write_child',
    'center_today',
    'get_my_daycare_id',
    'get_my_role',
    'has_permission',
    'has_permission_for_classroom',
    'is_admin',
    'is_staff',
    'my_child_ids',
    'my_classroom_ids',
    'my_family_ids',
    'my_staff_member_id',
    'shares_family_with',
    'storage_child_id',

    -- Pre-authentication center, registration and release checks.
    'check_center_registration_code',
    'check_daycare_signup_code',
    'get_mobile_release_config',
    'get_public_center_info',
    'get_staff_invite',
    'report_client_error',

    -- Token-scoped family enrollment and inquiry journeys.
    'accept_parent_enrollment_offer',
    'book_parent_enrollment_tour',
    'cancel_parent_enrollment_tour',
    'complete_demo_parent_enrollment_deposit',
    'complete_parent_inquiry_application',
    'continue_parent_enrollment_documents',
    'decline_parent_enrollment_offer',
    'get_parent_enrollment_offer',
    'get_parent_inquiry_center',
    'get_parent_inquiry_journey',
    'respond_parent_waitlist_checkin',
    'review_parent_enrollment_offer',
    'save_parent_enrollment_application',
    'save_parent_enrollment_document',
    'save_parent_inquiry_application',
    'save_parent_inquiry_document',
    'sign_parent_enrollment_agreement',
    'submit_enrollment_inquiry',
    'submit_enrollment_inquiry_v2',
    'submit_parent_enrollment_inquiry',

    -- Explicit read-only public compliance share.
    'read_compliance_inspection_share'
  ];
begin
  for v_function in
    select routine.oid
      from pg_proc routine
      join pg_namespace namespace on namespace.oid = routine.pronamespace
     where namespace.nspname = 'public'
       and routine.prorettype <> 'trigger'::regtype
       and not (routine.proname = any(v_anonymous_names))
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      v_function.oid::regprocedure
    );
  end loop;
end;
$$;

