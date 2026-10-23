-- Group 9c/9f: reminder eligibility belongs at the database boundary.
-- Autopay, settled invoices, and verified credentials must not receive nudges.

create function public.get_overdue_reminder_eligible_ids()
returns setof uuid
language sql stable security definer set search_path = public as $$
  select invoice.id
  from public.invoices invoice
  join public.profiles recipient on recipient.id = invoice.billed_to
  left join public.family_billing_preferences preferences
    on preferences.family_id = invoice.family_id
  where public.has_permission('billing', 'view')
    and invoice.daycare_id = public.get_my_daycare_id()
    and invoice.status in ('open', 'overdue')
    and invoice.due_on < public.center_today()
    and coalesce(preferences.autopay_enabled, false) = false
    and nullif(btrim(recipient.email), '') is not null
    and invoice.total_cents > coalesce((
      select sum(payment.amount_cents)
      from public.payments payment
      where payment.invoice_id = invoice.id and payment.status = 'succeeded'
    ), 0);
$$;

create function public.queue_overdue_invoice_reminders(p_invoice_ids uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_invoice public.invoices%rowtype;
  v_recipient public.profiles%rowtype;
  v_today date := public.center_today();
  v_balance int;
  v_tone text;
  v_outbox_id uuid;
  v_queued int := 0;
  v_skipped int := 0;
begin
  if auth.uid() is null or not public.has_permission('billing', 'edit') then
    raise exception 'Billing edit permission required';
  end if;
  if coalesce(array_length(p_invoice_ids, 1), 0) < 1
     or array_length(p_invoice_ids, 1) > 100 then
    raise exception 'Select between 1 and 100 invoices';
  end if;

  for v_id in select distinct candidate.id from unnest(p_invoice_ids) as candidate(id)
    where candidate.id is not null loop
    select * into v_invoice from public.invoices invoice
     where invoice.id = v_id and invoice.daycare_id = public.get_my_daycare_id()
     for update;
    if v_invoice.id is null or v_invoice.status not in ('open', 'overdue')
       or v_invoice.due_on is null or v_invoice.due_on >= v_today
       or exists (
         select 1 from public.family_billing_preferences preferences
         where preferences.family_id = v_invoice.family_id
           and preferences.autopay_enabled
       ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select * into v_recipient from public.profiles
     where id = v_invoice.billed_to and nullif(btrim(email), '') is not null;
    if v_recipient.id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    select v_invoice.total_cents - coalesce(sum(payment.amount_cents), 0)
      into v_balance from public.payments payment
     where payment.invoice_id = v_invoice.id and payment.status = 'succeeded';
    if v_balance <= 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select case when count(*) > 0 then 'firm' else 'friendly' end into v_tone
      from public.invoice_reminder_events event
     where event.invoice_id = v_invoice.id and event.status <> 'failed';
    -- The delivery record and audit event commit together. A duplicate request
    -- on the same center day is skipped by the outbox dedupe key.
    v_outbox_id := public.enqueue_email_notification(
      v_invoice.daycare_id, v_recipient.email, 'invoice_reminder',
      'Reminder: invoice ' || coalesce(v_invoice.number, 'from your center'),
      case when v_tone = 'friendly' then 'Hi ' else 'Hello ' end ||
        split_part(v_recipient.full_name, ' ', 1) ||
        ' — your invoice has an outstanding balance of ' ||
        to_char(v_balance::numeric / 100, 'FM$999,999,990.00') ||
        ' and was due ' || to_char(v_invoice.due_on, 'Mon FMDD, YYYY') ||
        '. Pay securely from the app, or reply to the center if something is up.',
      jsonb_build_object('type', 'invoice_reminder', 'invoiceId', v_invoice.id),
      'invoice-reminder:' || v_invoice.id::text || ':' || v_today::text
    );
    if v_outbox_id is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.invoice_reminder_events (
      daycare_id, invoice_id, sent_by, outbox_id, recipient_email, tone
    ) values (
      v_invoice.daycare_id, v_invoice.id, auth.uid(), v_outbox_id,
      lower(v_recipient.email), v_tone
    );
    v_queued := v_queued + 1;
  end loop;
  return jsonb_build_object('queued', v_queued, 'skipped', v_skipped);
end;
$$;

-- The follow-up is cancelled when a verified replacement becomes current.
-- It is marked failed (rather than deleted) to preserve delivery history and
-- to prevent retry_notification_delivery from reviving it.
create function public.cancel_verified_credential_followups()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.document_id is not null
     and new.archived_at is null
     and new.completed_on is not null
     and (new.expires_on is null or new.expires_on > public.center_today())
     and (new.document_id is distinct from old.document_id
       or new.completed_on is distinct from old.completed_on
       or new.expires_on is distinct from old.expires_on) then
    update public.notification_outbox outbox set
      status = 'failed',
      last_error = 'Cancelled: credential renewal verified before follow-up',
      locked_at = null
    where outbox.daycare_id = new.daycare_id
      and outbox.kind = 'credential_reminder'
      and outbox.dedupe_key like 'credential-reminder-follow-up:' || new.id::text || ':%'
      and outbox.status = 'pending';
  end if;
  return new;
end;
$$;

create trigger cancel_verified_credential_followups
after update of document_id, completed_on, expires_on on public.staff_credentials
for each row execute function public.cancel_verified_credential_followups();

revoke all on function public.get_overdue_reminder_eligible_ids() from public, anon;
revoke all on function public.queue_overdue_invoice_reminders(uuid[]) from public, anon;
grant execute on function public.get_overdue_reminder_eligible_ids() to authenticated;
grant execute on function public.queue_overdue_invoice_reminders(uuid[]) to authenticated;
notify pgrst, 'reload schema';
