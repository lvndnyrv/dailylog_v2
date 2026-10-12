-- Mobile Parent Group 16 tests. All mutations roll back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claims', case
    when p_role = 'postgres' then '{}'::jsonb
    else jsonb_build_object('sub', p_user_id, 'role', p_role)
  end::text, true);
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_other_parent constant uuid := '00000000-0000-4000-a000-000000000024';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_child constant uuid := '30000000-0000-4000-a000-000000000024';
  v_invite_id uuid := gen_random_uuid();
  v_email text;
  v_created_code text;
  v_preview jsonb;
  v_accepted jsonb;
  v_failed boolean := false;
begin
  select email into v_email from public.profiles where id = v_parent;

  insert into public.child_invite_codes (
    id, daycare_id, child_id, code, email, relationship, created_by, expires_at
  ) values (
    v_invite_id,
    '10000000-0000-4000-a000-000000000001',
    v_child,
    'G16TEST8',
    v_email,
    'Mother',
    v_owner,
    now() + interval '7 days'
  );

  perform pg_temp.impersonate('authenticated', v_other_parent);
  begin
    perform public.preview_parent_child_invite('G16TEST8');
  exception when others then
    v_failed := position('PARENT_INVITE_EMAIL_MISMATCH' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: an invite opened for the wrong signed-in email'; end if;
  raise notice 'PASS: email-bound invitations reject the wrong parent account';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_preview := public.preview_parent_child_invite('g16test8');
  if v_preview->>'child_id' <> v_child::text
     or v_preview->>'daycare_name' is null
     or v_preview->>'relationship' <> 'Mother'
     or coalesce((v_preview->>'already_linked')::boolean, false) then
    raise exception 'FAIL: invite preview was incomplete or consumed: %', v_preview;
  end if;
  -- Parents intentionally cannot select raw invitation rows. Assert the
  -- non-consuming preview as the database owner so this check cannot pass
  -- merely because RLS hid the row.
  perform pg_temp.impersonate('postgres');
  if exists (select 1 from public.child_invite_codes where id = v_invite_id and used_at is not null) then
    raise exception 'FAIL: preview consumed the invitation';
  end if;
  raise notice 'PASS: preview is informative and non-consuming';

  update public.profiles set daycare_id = null where id = v_parent;
  perform pg_temp.impersonate('authenticated', v_parent);
  v_accepted := public.accept_parent_child_invite('G16TEST8', 'Mother');
  if v_accepted->>'child_id' <> v_child::text then
    raise exception 'FAIL: accepted invite returned the wrong child: %', v_accepted;
  end if;
  if not exists (
    select 1 from public.parent_children
    where parent_id = v_parent and child_id = v_child
      and relationship = 'Mother' and consent_given_at is null
  ) then
    raise exception 'FAIL: confirmed family link or pending consent state is wrong';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = v_parent and daycare_id = '10000000-0000-4000-a000-000000000001'
  ) then
    raise exception 'FAIL: first family link did not adopt the parent into the child center';
  end if;
  -- The invitation table is admin-only by design. Inspect consumption outside
  -- the parent's RLS context, then restore the parent identity for retry.
  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.child_invite_codes
    where id = v_invite_id and used_by = v_parent and used_at is not null
  ) then
    raise exception 'FAIL: confirmed invitation was not consumed';
  end if;
  raise notice 'PASS: confirmed redemption links the child and leaves explicit consent pending';

  perform pg_temp.impersonate('authenticated', v_parent);
  v_accepted := public.accept_parent_child_invite('G16TEST8', 'Mother');
  if not (v_accepted->>'already_linked')::boolean then
    raise exception 'FAIL: retrying the same accepted link was not idempotent';
  end if;
  raise notice 'PASS: current user can safely retry their accepted invitation';

  perform pg_temp.impersonate('postgres');
  update public.child_invite_codes set email = null where id = v_invite_id;
  perform pg_temp.impersonate('authenticated', v_other_parent);
  v_failed := false;
  begin
    perform public.preview_parent_child_invite('G16TEST8');
  exception when others then
    v_failed := position('PARENT_INVITE_ALREADY_USED' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: another parent reused a consumed invitation'; end if;
  raise notice 'PASS: consumed invitations cannot be reused by another account';

  perform pg_temp.impersonate('postgres');
  update public.child_invite_codes
  set email = v_email, used_at = null, used_by = null, expires_at = now() - interval '1 minute'
  where id = v_invite_id;
  delete from public.parent_children where parent_id = v_parent and child_id = v_child;
  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.preview_parent_child_invite('G16TEST8');
  exception when others then
    v_failed := position('PARENT_INVITE_EXPIRED' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: expired invitation was accepted'; end if;
  raise notice 'PASS: expired invitations produce a recoverable typed error';

  perform pg_temp.impersonate('postgres');
  update public.child_invite_codes set expires_at = now() + interval '7 days' where id = v_invite_id;
  update public.children set archived_at = now() where id = v_child;
  perform pg_temp.impersonate('authenticated', v_parent);
  v_failed := false;
  begin
    perform public.preview_parent_child_invite('G16TEST8');
  exception when others then
    v_failed := position('PARENT_INVITE_UNAVAILABLE' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: an archived child was linked'; end if;
  raise notice 'PASS: invitations cannot expose or link an archived child';

  perform pg_temp.impersonate('postgres');
  update public.children set archived_at = null where id = v_child;
  perform pg_temp.impersonate('authenticated', v_owner);
  v_created_code := public.create_parent_invite(v_child, 'seven-day@example.com', 'Father');
  if not exists (
    select 1 from public.child_invite_codes invite
    where invite.code = v_created_code
      and invite.email = 'seven-day@example.com'
      and invite.relationship = 'Father'
      and invite.expires_at between now() + interval '6 days 23 hours'
                                and now() + interval '7 days 1 minute'
  ) then
    raise exception 'FAIL: newly created family invite did not use the seven-day policy';
  end if;
  raise notice 'PASS: new family invitations expire after seven days';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 16 TESTS: ALL PASSED' as result;
