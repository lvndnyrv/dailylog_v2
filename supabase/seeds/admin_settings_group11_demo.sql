-- Group 11 admin Settings demo facts. Idempotent and scoped to the documented
-- Sunny Grove fixture.
update public.daycares
set license_number = coalesce(license_number, 'DC-2019-0412'),
    sick_return_hours = 24,
    photo_consent_required = true,
    pickup_id_check_required = true,
    default_delegation_days = 14
where id = '10000000-0000-4000-a000-000000000001';

insert into public.late_pickup_policies (
  daycare_id, effective_from, closing_time, grace_minutes,
  fee_per_minute_cents, daily_cap_cents, conversation_after_count, created_by
)
select
  daycare.id, date '2000-01-01', daycare.closes_at, 5,
  100, 4000, 3, daycare.created_by
from public.daycares daycare
where daycare.id = '10000000-0000-4000-a000-000000000001'
on conflict (daycare_id, effective_from) do nothing;
