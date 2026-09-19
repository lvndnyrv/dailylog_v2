-- Group 2n: request every missing application document in one transaction.
--
-- The previous web action updated the application, created standing document
-- requests, and queued email in separate client calls. A failure in the middle
-- could leave only some documents requested. Keep the entire handoff behind a
-- center-scoped RPC so retries are safe and no family receives a request that
-- the application itself did not record.

create or replace function public.request_enrollment_documents(
  p_enrollment_id uuid,
  p_documents text[],
  p_message text,
  p_due_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_center_id uuid := public.get_my_daycare_id();
  v_enrollment public.enrollments%rowtype;
  v_document text;
  v_documents text[];
  v_statuses jsonb;
  v_existing_status text;
  v_message text := nullif(btrim(coalesce(p_message, '')), '');
  v_due_on date := coalesce(p_due_on, public.center_today() + 14);
  v_changed integer := 0;
  v_request jsonb;
  v_title text;
  v_screen text;
begin
  if auth.uid() is null
     or not public.is_admin()
     or not public.has_permission('enrollment', 'edit') then
    raise exception 'Administrator enrollment-edit permission required';
  end if;
  if p_enrollment_id is null then
    raise exception 'Choose an enrollment application';
  end if;
  if v_message is null then
    raise exception 'Write a message for the family';
  end if;
  if length(v_message) > 2000 then
    raise exception 'The request message is too long';
  end if;
  if v_due_on < public.center_today() or v_due_on > public.center_today() + 180 then
    raise exception 'Choose a due date within the next 180 days';
  end if;

  select array_agg(document order by document)
    into v_documents
    from (
      select distinct lower(btrim(value)) as document
        from unnest(coalesce(p_documents, array[]::text[])) value
       where nullif(btrim(value), '') is not null
    ) requested;

  if coalesce(cardinality(v_documents), 0) = 0 then
    raise exception 'Select at least one missing document';
  end if;
  if cardinality(v_documents) > 4
     or exists (
       select 1 from unnest(v_documents) document
        where document not in ('immunization', 'emergency_contacts', 'medical', 'handbook')
     ) then
    raise exception 'One or more document types are not supported';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_enrollment_id::text, 0));

  select * into v_enrollment
    from public.enrollments enrollment
   where enrollment.id = p_enrollment_id
     and enrollment.daycare_id = v_center_id
   for update;
  if v_enrollment.id is null then
    raise exception 'Enrollment application not found in this center';
  end if;
  if v_enrollment.stage = 'withdrawn' then
    raise exception 'Closed inquiries cannot receive document requests';
  end if;
  if v_enrollment.guardian_email is null
     or v_enrollment.guardian_email !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Add a valid guardian email before requesting documents';
  end if;

  v_statuses := coalesce(v_enrollment.documents_status, '{}'::jsonb);

  foreach v_document in array v_documents loop
    v_existing_status := case
      when jsonb_typeof(v_statuses->v_document) = 'object'
        then v_statuses->v_document->>'status'
      else trim(both '"' from coalesce((v_statuses->v_document)::text, ''))
    end;

    if v_existing_status in ('received', 'verified', 'accepted', 'uploaded', 'under_review') then
      raise exception '% is already on file', initcap(replace(v_document, '_', ' '));
    end if;

    if v_existing_status is distinct from 'requested' then
      v_changed := v_changed + 1;
    end if;

    v_statuses := jsonb_set(
      v_statuses,
      array[v_document],
      jsonb_strip_nulls(jsonb_build_object(
        'status', 'requested',
        'requested_at', now(),
        'due_on', v_due_on
      )),
      true
    );

    -- Enrolled families answer in the standing document vault. Calling the
    -- existing guarded function inside this transaction preserves its parent
    -- notification behavior while making the whole batch atomic.
    if v_enrollment.child_id is not null and v_existing_status is distinct from 'requested' then
      v_title := case v_document
        when 'immunization' then 'Updated immunization record'
        when 'emergency_contacts' then 'Emergency contacts'
        when 'medical' then 'Allergy & medical form'
        when 'handbook' then 'Signed parent handbook'
      end;
      v_request := public.create_parent_document_request(
        v_enrollment.child_id,
        v_document,
        v_title,
        v_message,
        v_due_on
      );
      if v_request->>'id' is null then
        raise exception 'The standing document request could not be created';
      end if;
    end if;
  end loop;

  if v_changed = 0 then
    return jsonb_build_object(
      'status', 'requested',
      'retry', true,
      'enrollment_id', v_enrollment.id,
      'documents', to_jsonb(v_documents),
      'due_on', v_due_on
    );
  end if;

  update public.enrollments
     set documents_status = v_statuses,
         updated_at = now()
   where id = v_enrollment.id;

  v_screen := case
    when v_enrollment.child_id is null then 'ParentInquiryJourney'
    else 'ParentDocuments'
  end;

  insert into public.notification_outbox (
    daycare_id, recipient_email, channel, kind, title, body, payload, dedupe_key
  ) values (
    v_center_id,
    lower(v_enrollment.guardian_email),
    'email',
    'enrollment_documents',
    'Documents needed for ' || coalesce(v_enrollment.child_first_name, 'your application'),
    v_message,
    jsonb_build_object(
      'type', 'enrollment_documents',
      'screen', v_screen,
      'journeyCode', upper(v_enrollment.offer_code),
      'enrollment_id', v_enrollment.id,
      'childId', v_enrollment.child_id,
      'documents', to_jsonb(v_documents),
      'due_on', v_due_on
    ),
    'documents:' || v_enrollment.id || ':' || array_to_string(v_documents, '-')
  ) on conflict do nothing;

  return jsonb_build_object(
    'status', 'requested',
    'retry', false,
    'enrollment_id', v_enrollment.id,
    'documents', to_jsonb(v_documents),
    'due_on', v_due_on,
    'standing_requests', v_enrollment.child_id is not null
  );
end;
$$;

revoke all on function public.request_enrollment_documents(uuid, text[], text, date)
  from public, anon;
grant execute on function public.request_enrollment_documents(uuid, text[], text, date)
  to authenticated;

notify pgrst, 'reload schema';
