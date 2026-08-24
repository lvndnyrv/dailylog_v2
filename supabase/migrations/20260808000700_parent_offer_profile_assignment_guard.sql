-- Allow a newly authenticated parent to adopt the center of a paid enrollment
-- offer issued to that same verified email. Other role/center mutations retain
-- the existing staff-approval guard.

create or replace function public.enforce_profile_role_assignment()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or (auth.uid() is null and auth.role() is null) then return new; end if;
  if new.role is not distinct from old.role
     and new.daycare_id is not distinct from old.daycare_id
     and new.center_role_id is not distinct from old.center_role_id then return new; end if;

  -- First-time center owner setup.
  if new.id = auth.uid() and old.daycare_id is null and new.role = 'owner_admin'
     and exists (select 1 from daycares d where d.id = new.daycare_id and d.created_by = auth.uid()) then
    select id into new.center_role_id from center_roles
     where daycare_id = new.daycare_id and name = 'Owner admin' limit 1;
    return new;
  end if;
  -- Invite acceptance can attach the invitee to the invited center/role.
  if new.id = auth.uid() and old.daycare_id is null and exists (
    select 1 from staff_invites si
     where lower(si.email) = lower(new.email) and si.daycare_id = new.daycare_id
       and si.role = new.role and si.accepted_at is null
       and (si.expires_at is null or si.expires_at > now())
  ) then return new; end if;
  -- Legacy center join codes are still supported during the migration window.
  if new.id = auth.uid() and old.daycare_id is null and exists (
    select 1 from daycare_signup_codes dc
     where dc.daycare_id = new.daycare_id and dc.role = new.role
       and coalesce(dc.uses_remaining, 0) > 0
       and (dc.expires_at is null or dc.expires_at > now())
  ) then return new; end if;
  -- A parent adopts the linked child's center when redeeming an invite.
  if new.id = auth.uid() and new.role = 'parent' and old.daycare_id is null
     and new.daycare_id is not null and exists (
    select 1 from child_invite_codes ci
    join children c on c.id = ci.child_id
     where c.daycare_id = new.daycare_id and ci.used_at is null
       and (ci.email is null or lower(ci.email) = lower(new.email))
       and (ci.expires_at is null or ci.expires_at > now())
  ) then return new; end if;
  -- Group 24: completed secure offer issued to this exact parent email.
  if new.id = auth.uid() and new.role = 'parent' and old.daycare_id is null
     and new.daycare_id is not null and exists (
    select 1 from enrollments e
     where e.daycare_id = new.daycare_id
       and e.child_id is not null
       and e.stage = 'enrolled'
       and e.offer_status = 'accepted'
       and e.deposit_status = 'paid'
       and lower(e.guardian_email) = lower(new.email)
  ) then return new; end if;

  if not has_permission('staff', 'approve') then raise exception 'Staff approval permission required'; end if;
  if new.role is distinct from old.role
     and new.center_role_id is not distinct from old.center_role_id then
    select r.id into new.center_role_id
      from center_roles r
     where r.daycare_id = new.daycare_id
       and r.name = default_role_name(new.role, null, new.classroom_id)
     limit 1;
  end if;
  return new;
end;
$$;
