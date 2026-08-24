-- Notification delivery runs from Supabase Cron. The project-specific worker
-- secret and endpoint are configured through Edge Function Secrets, Vault and
-- the Cron UI; keeping those values out of migrations prevents secret leakage.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
