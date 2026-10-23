-- Internal evidence attached to an invoice-line decision. Dates describe the
-- care billed, not the payment year or a determination of tax eligibility.
alter table public.billing_annual_line_reviews
  add column service_start_on date,
  add column service_end_on date,
  add column service_evidence_note text not null default '';

alter table public.billing_annual_line_reviews
  add constraint billing_annual_service_dates_pair check (
    (service_start_on is null and service_end_on is null)
    or (service_start_on is not null and service_end_on is not null
      and service_start_on <= service_end_on)
  ),
  add constraint billing_annual_service_evidence_length check (
    char_length(service_evidence_note) <= 500
    and (service_start_on is null or char_length(btrim(service_evidence_note)) >= 8)
  );

create or replace function public.audit_billing_annual_line_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (daycare_id, actor_id, action, entity_type, entity_id, before, after)
  values (
    new.daycare_id, auth.uid(), lower(tg_op), 'billing_annual_line_reviews', new.invoice_line_id,
    case when tg_op = 'UPDATE' then jsonb_build_object(
      'review_year', old.review_year, 'classification', old.classification,
      'note_recorded', old.note <> '',
      'service_start_on', old.service_start_on, 'service_end_on', old.service_end_on,
      'service_evidence_recorded', old.service_evidence_note <> ''
    ) else null end,
    jsonb_build_object('review_year', new.review_year, 'classification', new.classification,
      'note_recorded', new.note <> '',
      'service_start_on', new.service_start_on, 'service_end_on', new.service_end_on,
      'service_evidence_recorded', new.service_evidence_note <> '')
  );
  return new;
end;
$$;
