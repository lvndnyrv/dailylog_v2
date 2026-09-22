-- Group 4d: make pending staff invitations inspectable and safely resendable.

alter table public.staff_invites
  add column if not exists last_sent_at timestamptz,
  add column if not exists resend_count integer not null default 0;

update public.staff_invites
   set last_sent_at = coalesce(last_sent_at, created_at, now())
 where last_sent_at is null;

alter table public.staff_invites
  alter column last_sent_at set default now(),
  alter column last_sent_at set not null;

alter table public.staff_invites
  drop constraint if exists staff_invites_resend_count_check;
alter table public.staff_invites
  add constraint staff_invites_resend_count_check check (resend_count >= 0);

create or replace function public.resend_staff_invite(p_invite_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_invite public.staff_invites%rowtype;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  if v_daycare is null or not public.has_permission('staff', 'edit') then
    raise exception 'Staff edit permission required';
  end if;

  select invite.* into v_invite
    from public.staff_invites invite
   where invite.id = p_invite_id
     and invite.daycare_id = v_daycare
     and invite.accepted_at is null
   for update;
  if v_invite.id is null then
    raise exception 'This invitation is no longer available';
  end if;

  perform public.assert_rate_limit(
    'staff_invite_resend',
    5,
    600,
    p_invite_id::text
  );

  -- Rotating the bearer code invalidates any forwarded or expired link.
  v_code := public.generate_invite_code();
  update public.staff_invites invite
     set code = v_code,
         expires_at = now() + interval '7 days',
         last_sent_at = now(),
         resend_count = invite.resend_count + 1
   where invite.id = v_invite.id
   returning invite.* into v_invite;

  return jsonb_build_object(
    'code', v_invite.code,
    'email', v_invite.email,
    'expiresAt', v_invite.expires_at,
    'resendCount', v_invite.resend_count
  );
end;
$$;

revoke all on function public.resend_staff_invite(uuid) from public, anon;
grant execute on function public.resend_staff_invite(uuid) to authenticated, service_role;

-- Invite codes are bearer secrets. Audit the lifecycle without copying a code
-- into the audit log's before/after snapshots.
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
      when tg_op = 'UPDATE' and old.last_sent_at is distinct from new.last_sent_at
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

drop trigger if exists audit_staff_invite_lifecycle on public.staff_invites;
create trigger audit_staff_invite_lifecycle
  after insert or update or delete on public.staff_invites
  for each row execute function public.audit_staff_invite_lifecycle();
