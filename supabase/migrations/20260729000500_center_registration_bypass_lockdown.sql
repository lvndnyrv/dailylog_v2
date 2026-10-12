-- ============================================================================
-- DailyLog — remove legacy self-service center creation paths
-- ============================================================================
-- Center creation is now exclusively performed by the guarded six-argument
-- complete_center_setup RPC after it locks an email-bound registration code.

-- The original onboarding policy allowed any signed-in account to insert a
-- daycare directly through PostgREST. Security-definer setup/location RPCs do
-- not rely on this policy, so it is safe to remove.
drop policy if exists "authed users create daycares" on daycares;

-- This companion policy only existed to let a self-service creator read the
-- row between inserting the daycare and attaching their profile.
drop policy if exists "creator reads own new daycare" on daycares;

-- The legacy one-field onboarding RPC creates a daycare and elevates its
-- caller to owner_admin without a platform-issued registration code.
revoke all on function start_center(text)
  from public, anon, authenticated;

comment on function start_center(text) is
  'Legacy internal function. App execution revoked; use guarded complete_center_setup with a platform-issued registration code.';
