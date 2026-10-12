-- Group 9c: every payment reminder is visible on the invoice/family statement.
create table if not exists public.invoice_reminder_events (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references public.daycares(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sent_by uuid not null references public.profiles(id),
  outbox_id uuid references public.notification_outbox(id) on delete set null,
  recipient_email text not null,
  tone text not null default 'friendly' check (tone in ('friendly', 'firm')),
  status text not null default 'queued' check (status in ('queued', 'delivered', 'failed')),
  sent_at timestamptz not null default now()
);

create index if not exists invoice_reminder_events_invoice_sent_idx
  on public.invoice_reminder_events (invoice_id, sent_at desc);

alter table public.invoice_reminder_events enable row level security;

drop policy if exists "billing staff read invoice reminder history" on public.invoice_reminder_events;
create policy "billing staff read invoice reminder history" on public.invoice_reminder_events
  for select using (
    daycare_id = public.get_my_daycare_id()
    and public.has_permission('billing', 'view')
  );

drop policy if exists "billing staff add invoice reminder history" on public.invoice_reminder_events;
create policy "billing staff add invoice reminder history" on public.invoice_reminder_events
  for insert with check (
    daycare_id = public.get_my_daycare_id()
    and sent_by = auth.uid()
    and public.has_permission('billing', 'edit')
    and exists (
      select 1 from public.invoices invoice
      where invoice.id = invoice_id and invoice.daycare_id = daycare_id
    )
  );

drop policy if exists "families read own invoice reminder history" on public.invoice_reminder_events;
create policy "families read own invoice reminder history" on public.invoice_reminder_events
  for select using (
    exists (
      select 1
        from public.invoices invoice
       where invoice.id = invoice_id
         and invoice.daycare_id = daycare_id
         and (
           invoice.billed_to = auth.uid()
           or invoice.family_id in (
             select member.family_id from public.family_members member
             where member.profile_id = auth.uid()
           )
         )
    )
  );
