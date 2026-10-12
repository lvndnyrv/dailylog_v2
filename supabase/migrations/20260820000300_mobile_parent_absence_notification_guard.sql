-- Restore attendance notification routing lost when the enrollment payment
-- guard superseded the earlier trigger, and allow only validated parent absence
-- RPC notifications through the staff-only outbox boundary.

create or replace function public._notify_parent_absence(
  p_report public.parent_absence_reports,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.children%rowtype;
  v_reason_label text := initcap(replace(p_report.reason, '_', ' '));
  v_title text;
  v_body text;
  v_event_key text;
  v_type text;
begin
  if p_action not in ('created', 'updated', 'cancelled') then
    raise exception 'Unsupported absence notification action';
  end if;

  select * into v_child from public.children where id = p_report.child_id;
  v_type := case when p_action = 'cancelled'
    then 'attendance_absence_cancelled' else 'attendance_absence' end;
  v_title := case p_action
    when 'created' then v_child.first_name || ' will be absent'
    when 'updated' then v_child.first_name || '''s absence was updated'
    else v_child.first_name || '''s absence was cancelled'
  end;
  v_body := case when p_action = 'cancelled' then
    to_char(p_report.starts_on, 'Mon FMDD') || case
      when p_report.ends_on = p_report.starts_on then ''
      else '–' || to_char(p_report.ends_on, 'Mon FMDD') end
  else
    v_reason_label || ' · ' || to_char(p_report.starts_on, 'Mon FMDD') || case
      when p_report.ends_on = p_report.starts_on then ''
      else '–' || to_char(p_report.ends_on, 'Mon FMDD') end
      || coalesce(' · ' || p_report.note, '')
  end;
  v_event_key := 'parent-absence:' || p_report.id || ':' || p_action || ':'
    || extract(epoch from p_report.updated_at)::text;

  perform set_config('dailylog.parent_absence_report_id', p_report.id::text, true);

  with recipients as (
    select profile.id
      from public.profiles profile
     where profile.daycare_id = p_report.daycare_id
       and profile.archived_at is null
       and (
         profile.role in ('owner_admin', 'admin')
         or (
           profile.role = 'educator'
           and (
             profile.classroom_id = v_child.classroom_id
             or exists (
               select 1 from public.educator_classrooms assignment
                where assignment.educator_id = profile.id
                  and assignment.classroom_id = v_child.classroom_id
             )
           )
         )
       )
  )
  insert into public.notification_outbox (
    daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
  )
  select p_report.daycare_id, recipient.id, 'push', 'attendance',
         v_title, v_body,
         jsonb_build_object(
           'type', v_type,
           'screen', 'Attendance',
           'childId', p_report.child_id,
           'reportId', p_report.id,
           'startsOn', p_report.starts_on,
           'endsOn', p_report.ends_on,
           'href', '/attendance?date=' || p_report.starts_on,
           'eventKey', v_event_key
         ),
         v_event_key
    from recipients recipient
  on conflict do nothing;

  with recipients as (
    select profile.id
      from public.profiles profile
     where profile.daycare_id = p_report.daycare_id
       and profile.archived_at is null
       and (
         profile.role in ('owner_admin', 'admin')
         or (
           profile.role = 'educator'
           and (
             profile.classroom_id = v_child.classroom_id
             or exists (
               select 1 from public.educator_classrooms assignment
                where assignment.educator_id = profile.id
                  and assignment.classroom_id = v_child.classroom_id
             )
           )
         )
       )
  )
  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  )
  select p_report.daycare_id, recipient.id, 'attendance', v_title, v_body,
         jsonb_build_object(
           'type', v_type,
           'screen', 'Attendance',
           'childId', p_report.child_id,
           'reportId', p_report.id,
           'startsOn', p_report.starts_on,
           'endsOn', p_report.ends_on,
           'href', '/attendance?date=' || p_report.starts_on,
           'eventKey', v_event_key
         )
    from recipients recipient
   where not exists (
     select 1 from public.notifications notification
      where notification.profile_id = recipient.id
        and notification.payload->>'eventKey' = v_event_key
   );
end;
$$;

create or replace function public.enforce_notification_enqueue_permission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_area text;
  v_marker text;
  v_family_id uuid;
  v_payment_id uuid;
  v_enrollment_id uuid;
  v_report_id uuid;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then
    return new;
  end if;

  if auth.role() = 'anon' and new.kind in (
    'enrollment_inquiry_received', 'tour_confirmation', 'waitlist_confirmation'
  ) then
    return new;
  end if;

  if new.kind = 'parent_enrollment_receipt'
     and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_enrollment_payment_id', true);
    begin
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
      v_enrollment_id := nullif(new.payload->>'enrollmentId', '')::uuid;
    exception when invalid_text_representation then
      v_payment_id := null;
      v_enrollment_id := null;
    end;
    if v_marker = v_payment_id::text and exists (
      select 1
        from public.enrollment_offer_payments payment
        join public.enrollments enrollment on enrollment.id = payment.enrollment_id
          and payment.enrollment_id = v_enrollment_id
       where payment.id = v_payment_id
         and payment.status = 'succeeded'
         and lower(payment.receipt_emailed_to) = lower(new.recipient_email)
         and lower(enrollment.guardian_email) = lower(new.recipient_email)
    ) then
      return new;
    end if;
  end if;

  if auth.uid() is not null and new.kind = 'parent_payment_receipt'
     and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_demo_payment_family', true);
    begin
      v_family_id := nullif(new.payload->>'familyId', '')::uuid;
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
    exception when invalid_text_representation then
      v_family_id := null;
      v_payment_id := null;
    end;
    if v_marker = v_family_id::text
       and coalesce(public.can_manage_family_billing(v_family_id), false)
       and exists (
         select 1 from public.payments payment
          where payment.id = v_payment_id
            and payment.family_id = v_family_id
            and payment.status = 'succeeded'
            and lower(payment.receipt_emailed_to) = lower(new.recipient_email)
       ) then
      return new;
    end if;
  end if;

  if auth.uid() is not null and new.kind = 'attendance'
     and new.channel = 'push' and new.recipient_id is not null
     and new.payload->>'type' in ('attendance_absence', 'attendance_absence_cancelled') then
    v_marker := current_setting('dailylog.parent_absence_report_id', true);
    begin
      v_report_id := nullif(new.payload->>'reportId', '')::uuid;
    exception when invalid_text_representation then
      v_report_id := null;
    end;
    if v_marker = v_report_id::text and exists (
      select 1
        from public.parent_absence_reports report
        join public.profiles recipient on recipient.id = new.recipient_id
        join public.children child on child.id = report.child_id
       where report.id = v_report_id
         and report.reported_by = auth.uid()
         and report.daycare_id = new.daycare_id
         and report.child_id::text = new.payload->>'childId'
         and recipient.daycare_id = report.daycare_id
         and recipient.archived_at is null
         and (
           recipient.role in ('owner_admin', 'admin')
           or (
             recipient.role = 'educator'
             and (
               recipient.classroom_id = child.classroom_id
               or exists (
                 select 1 from public.educator_classrooms assignment
                  where assignment.educator_id = recipient.id
                    and assignment.classroom_id = child.classroom_id
               )
             )
           )
         )
    ) then
      return new;
    end if;
  end if;

  if new.kind = 'time_off' then
    if not public.has_permission('staff', 'approve') then
      raise exception 'staff approve permission required';
    end if;
    return new;
  end if;

  v_area := case
    when new.kind in (
      'enrollment_inquiry_received', 'tour_confirmation', 'enrollment_application',
      'enrollment_documents', 'waitlist_offer', 'offer_reminder',
      'offer_withdrawn', 'inquiry_closed', 'waitlist_checkin',
      'waitlist_confirmation', 'waitlist_position_changed'
    ) then 'enrollment'
    when new.kind = 'announcement' then 'broadcasts'
    when new.kind = 'incident' then 'incidents'
    when new.kind = 'medication' then 'medications'
    when new.kind in ('invoice', 'payment', 'parent_payment_receipt', 'parent_enrollment_receipt') then 'billing'
    when new.kind = 'staff_invite' then 'staff'
    when new.kind = 'parent_invite' then 'children'
    when new.kind = 'attendance' then 'attendance'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then
    raise exception '% edit permission required', v_area;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
