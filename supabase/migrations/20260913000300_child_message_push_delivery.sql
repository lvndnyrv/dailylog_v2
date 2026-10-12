-- Deliver private child-conversation messages while the recipient is away
-- from the app. The database independently re-validates every recipient at
-- enqueue time so a forged outbox insert cannot cross a family or classroom
-- boundary.

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
  v_pickup_id uuid;
  v_message_id uuid;
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if auth.role() = 'anon' and new.kind in ('enrollment_inquiry_received', 'tour_confirmation', 'waitlist_confirmation') then return new; end if;

  if new.kind = 'parent_enrollment_receipt' and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_enrollment_payment_id', true);
    begin
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
      v_enrollment_id := nullif(new.payload->>'enrollmentId', '')::uuid;
    exception when invalid_text_representation then v_payment_id := null; v_enrollment_id := null; end;
    if v_marker = v_payment_id::text and exists (
      select 1 from public.enrollment_offer_payments payment
      join public.enrollments enrollment on enrollment.id = payment.enrollment_id and payment.enrollment_id = v_enrollment_id
      where payment.id = v_payment_id and payment.status = 'succeeded'
        and lower(payment.receipt_emailed_to) = lower(new.recipient_email)
        and lower(enrollment.guardian_email) = lower(new.recipient_email)
    ) then return new; end if;
  end if;

  if auth.uid() is not null and new.kind = 'parent_payment_receipt' and new.channel = 'email' and new.recipient_id is null then
    v_marker := current_setting('dailylog.parent_demo_payment_family', true);
    begin
      v_family_id := nullif(new.payload->>'familyId', '')::uuid;
      v_payment_id := nullif(new.payload->>'paymentId', '')::uuid;
    exception when invalid_text_representation then v_family_id := null; v_payment_id := null; end;
    if v_marker = v_family_id::text and coalesce(public.can_manage_family_billing(v_family_id), false)
       and exists (select 1 from public.payments payment where payment.id = v_payment_id and payment.family_id = v_family_id and payment.status = 'succeeded' and lower(payment.receipt_emailed_to) = lower(new.recipient_email))
    then return new; end if;
  end if;

  if auth.uid() is not null and new.kind = 'attendance' and new.channel = 'push' and new.recipient_id is not null
     and new.payload->>'type' in ('attendance_absence', 'attendance_absence_cancelled') then
    v_marker := current_setting('dailylog.parent_absence_report_id', true);
    begin v_report_id := nullif(new.payload->>'reportId', '')::uuid;
    exception when invalid_text_representation then v_report_id := null; end;
    if v_marker = v_report_id::text and exists (
      select 1 from public.parent_absence_reports report
      join public.profiles recipient on recipient.id = new.recipient_id
      join public.children child on child.id = report.child_id
      where report.id = v_report_id and report.reported_by = auth.uid()
        and report.daycare_id = new.daycare_id and report.child_id::text = new.payload->>'childId'
        and recipient.daycare_id = report.daycare_id and recipient.archived_at is null
        and (recipient.role in ('owner_admin', 'admin') or (recipient.role = 'educator' and (recipient.classroom_id = child.classroom_id or exists (select 1 from public.educator_classrooms assignment where assignment.educator_id = recipient.id and assignment.classroom_id = child.classroom_id))))
    ) then return new; end if;
  end if;

  if auth.uid() is not null and new.kind = 'pickup_review' and new.channel = 'push' and new.recipient_id is not null then
    begin v_pickup_id := nullif(new.payload->>'pickupId', '')::uuid;
    exception when invalid_text_representation then v_pickup_id := null; end;
    if exists (
      select 1 from public.child_pickups pickup join public.profiles recipient on recipient.id = new.recipient_id
      where pickup.id = v_pickup_id and pickup.requested_by = auth.uid() and pickup.approval_status = 'pending'
        and pickup.archived_at is null and pickup.daycare_id = new.daycare_id
        and pickup.child_id::text = new.payload->>'childId' and recipient.daycare_id = pickup.daycare_id
        and recipient.role in ('owner_admin', 'admin') and recipient.archived_at is null
    ) then return new; end if;
  end if;

  if auth.uid() is not null and new.kind = 'parent_messages'
     and new.channel = 'push' and new.recipient_id is not null then
    v_marker := current_setting('dailylog.child_message_id', true);
    begin v_message_id := nullif(new.payload->>'messageId', '')::uuid;
    exception when invalid_text_representation then v_message_id := null; end;

    if v_marker = v_message_id::text and exists (
      select 1
      from public.messages message
      join public.conversations conversation
        on conversation.id = message.conversation_id
       and conversation.kind = 'direct'
       and conversation.child_id = message.child_id
      join public.children child on child.id = message.child_id
      join public.profiles sender on sender.id = message.sender_id
      join public.profiles recipient on recipient.id = new.recipient_id
      where message.id = v_message_id
        and message.sender_id = auth.uid()
        and message.daycare_id = new.daycare_id
        and message.child_id::text = new.payload->>'childId'
        and message.conversation_id::text = new.payload->>'conversationId'
        and sender.daycare_id = message.daycare_id
        and recipient.daycare_id = message.daycare_id
        and recipient.archived_at is null
        and recipient.id <> sender.id
        and (
          (
            sender.role = 'parent'
            and public.profile_has_permission(recipient.id, 'children', 'view')
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
          )
          or (
            sender.role <> 'parent'
            and recipient.role = 'parent'
            and exists (
              select 1 from public.parent_children link
              where link.parent_id = recipient.id
                and link.child_id = message.child_id
            )
          )
        )
    ) then return new; end if;
  end if;

  if new.kind = 'time_off' then
    if not public.has_permission('staff', 'approve') then raise exception 'staff approve permission required'; end if;
    return new;
  end if;

  v_area := case
    when new.kind in (
      'enrollment_inquiry_received', 'tour_confirmation', 'enrollment_application',
      'enrollment_documents', 'waitlist_offer', 'offer_reminder',
      'offer_withdrawn', 'inquiry_closed', 'waitlist_checkin',
      'waitlist_confirmation', 'waitlist_position_changed', 'enrollment_welcome'
    ) then 'enrollment'
    when new.kind = 'announcement' then 'broadcasts'
    when new.kind = 'incident' then 'incidents'
    when new.kind = 'medication' then 'medications'
    when new.kind in ('invoice', 'invoice_reminder', 'payment', 'parent_payment_receipt', 'parent_enrollment_receipt') then 'billing'
    when new.kind in ('staff_invite', 'credential_reminder') then 'staff'
    when new.kind = 'room_activity_nudge' then 'rooms'
    when new.kind in ('parent_invite', 'pickup_review', 'pickup_reviewed') then 'children'
    when new.kind = 'attendance' then 'attendance'
    else 'daily_logs'
  end;
  if not public.has_permission(v_area, 'edit') then raise exception '% edit permission required', v_area; end if;
  return new;
end;
$$;

create or replace function public.notify_child_conversation_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation public.conversations%rowtype;
  v_sender public.profiles%rowtype;
  v_child public.children%rowtype;
  v_child_name text;
  v_title text;
  v_body text;
  v_payload jsonb;
begin
  if new.conversation_id is null or new.child_id is null then return new; end if;

  select * into v_conversation
    from public.conversations conversation
   where conversation.id = new.conversation_id;
  if v_conversation.id is null or v_conversation.kind <> 'direct'
     or v_conversation.child_id is distinct from new.child_id then
    return new;
  end if;

  select * into v_sender from public.profiles profile where profile.id = new.sender_id;
  select * into v_child from public.children child where child.id = new.child_id;
  if v_sender.id is null or v_child.id is null then return new; end if;

  v_child_name := concat_ws(' ', v_child.first_name, v_child.last_name);
  v_title := case when v_sender.role = 'parent'
    then 'New family message'
    else 'New message from ' || coalesce(nullif(v_sender.full_name, ''), 'your center')
  end;
  v_body := case when v_sender.role = 'parent'
    then coalesce(nullif(v_sender.full_name, ''), 'A parent') ||
      ' sent a message about ' || v_child.first_name || '.'
    else coalesce(nullif(v_sender.full_name, ''), 'Your center') ||
      ' replied about ' || v_child.first_name || '.'
  end;
  v_payload := jsonb_build_object(
    'type', 'parent_messages',
    'screen', 'Messaging',
    'childId', new.child_id,
    'childName', v_child_name,
    'conversationId', new.conversation_id,
    'messageId', new.id,
    'href', '/messages?child=' || new.child_id,
    'source', 'Messages',
    'action_label', 'Open conversation'
  );

  perform set_config('dailylog.child_message_id', new.id::text, true);

  if v_sender.role = 'parent' then
    with recipients as (
      select recipient.id
      from public.profiles recipient
      where recipient.daycare_id = new.daycare_id
        and recipient.id <> new.sender_id
        and recipient.archived_at is null
        and public.profile_has_permission(recipient.id, 'children', 'view')
        and (
          recipient.role in ('owner_admin', 'admin')
          or (
            recipient.role = 'educator'
            and (
              recipient.classroom_id = v_child.classroom_id
              or exists (
                select 1 from public.educator_classrooms assignment
                where assignment.educator_id = recipient.id
                  and assignment.classroom_id = v_child.classroom_id
              )
            )
          )
        )
    ), inbox as (
      insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
      select new.daycare_id, recipient.id, 'parent_messages', v_title, v_body, v_payload
      from recipients recipient
      where not exists (
        select 1 from public.notifications notification
        where notification.profile_id = recipient.id
          and notification.payload ->> 'messageId' = new.id::text
      )
      returning profile_id
    )
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select new.daycare_id, recipient.id, 'push', 'parent_messages',
           v_title, v_body, v_payload, 'child-message:' || new.id || ':' || recipient.id
    from recipients recipient
    left join public.notification_preferences preference
      on preference.profile_id = recipient.id and preference.kind = 'parent_messages'
    where coalesce(preference.push, true)
    on conflict do nothing;
  else
    with recipients as (
      select distinct recipient.id
      from public.parent_children link
      join public.profiles recipient on recipient.id = link.parent_id
      where link.child_id = new.child_id
        and recipient.role = 'parent'
        and recipient.archived_at is null
        and recipient.id <> new.sender_id
    ), inbox as (
      insert into public.notifications (daycare_id, profile_id, kind, title, body, payload)
      select new.daycare_id, recipient.id, 'parent_messages', v_title, v_body, v_payload
      from recipients recipient
      where not exists (
        select 1 from public.notifications notification
        where notification.profile_id = recipient.id
          and notification.payload ->> 'messageId' = new.id::text
      )
      returning profile_id
    )
    insert into public.notification_outbox (
      daycare_id, recipient_id, channel, kind, title, body, payload, dedupe_key
    )
    select new.daycare_id, recipient.id, 'push', 'parent_messages',
           v_title, v_body, v_payload, 'child-message:' || new.id || ':' || recipient.id
    from recipients recipient
    left join public.notification_preferences preference
      on preference.profile_id = recipient.id and preference.kind = 'parent_messages'
    where coalesce(preference.push, true)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_child_conversation_message()
  from public, anon, authenticated;

comment on function public.notify_child_conversation_message() is
  'Creates private in-app and preference-aware push alerts for family/staff child-conversation messages.';

notify pgrst, 'reload schema';
