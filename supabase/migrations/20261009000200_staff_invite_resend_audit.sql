-- Recognize invite resends by their monotonic counter. PostgreSQL's now() is
-- transaction-stable, so last_sent_at may not change when an invite is created
-- and resent in the same transaction (as happens in rollback-safe verification).
create or replace function public.audit_staff_invite_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) - 'code' end;
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) - 'code' end;
begin
  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    coalesce(new.daycare_id, old.daycare_id),
    auth.uid(),
    case
      when tg_op = 'UPDATE' and old.accepted_at is null and new.accepted_at is not null
        then 'accepted'
      when tg_op = 'UPDATE' and old.resend_count is distinct from new.resend_count
        then 'resent'
      when tg_op = 'DELETE' then 'cancelled'
      else lower(tg_op)
    end,
    'staff_invites',
    coalesce(new.id, old.id),
    v_old,
    v_new
  );
  return coalesce(new, old);
end;
$$;
