-- Let the authorization-specific checks (including PRN daily limits) return
-- their precise error before the generic near-simultaneous duplicate guard.
drop trigger if exists enforce_medication_dose_integrity
  on public.medication_logs;
drop trigger if exists zz_enforce_medication_dose_integrity
  on public.medication_logs;
create trigger zz_enforce_medication_dose_integrity
  before insert on public.medication_logs
  for each row execute function public.enforce_medication_dose_integrity();
