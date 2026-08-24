-- Mobile Parent Group 16 tests. All mutations roll back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', p_role)::text,
    true
  );
end;
$$;

do $$
declare
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000024';
  v_invite_id uuid := gen_random_uuid();
  v_email text;
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
    'Parent',
    '00000000-0000-4000-a000-000000000001',
    now() + interval '7 days'
  );

  perform pg_temp.impersonate('authenticated', v_parent);
  v_preview := public.preview_parent_child_invite('g16test8');
  if v_preview->>'child_id' <> v_child::text
     or v_preview->>'daycare_name' is null
     or coalesce((v_preview->>'already_linked')::boolean, false) then
    raise exception 'FAIL: invite preview was incomplete or consumed: %', v_preview;
  end if;
  if exists (select 1 from public.child_invite_codes where id = v_invite_id and used_at is not null) then
    raise exception 'FAIL: preview consumed the invitation';
  end if;
  raise notice 'PASS: preview is informative and non-consuming';

  v_accepted := public.accept_parent_child_invite('G16TEST8', 'Grandparent');
  if v_accepted->>'child_id' <> v_child::text then
    raise exception 'FAIL: accepted invite returned the wrong child: %', v_accepted;
  end if;
  if not exists (
    select 1 from public.parent_children
    where parent_id = v_parent and child_id = v_child
      and relationship = 'Grandparent' and consent_given_at is null
  ) then
    raise exception 'FAIL: confirmed family link or pending consent state is wrong';
  end if;
  if not exists (
    select 1 from public.child_invite_codes
    where id = v_invite_id and used_by = v_parent and used_at is not null
  ) then
    raise exception 'FAIL: confirmed invitation was not consumed';
  end if;
  raise notice 'PASS: confirmed redemption links the child and leaves explicit consent pending';

  v_accepted := public.accept_parent_child_invite('G16TEST8', 'Grandparent');
  if not (v_accepted->>'already_linked')::boolean then
    raise exception 'FAIL: retrying the same accepted link was not idempotent';
  end if;
  raise notice 'PASS: current user can safely retry their accepted invitation';

  perform pg_temp.impersonate('postgres');
  update public.child_invite_codes
  set used_at = null, used_by = null, expires_at = now() - interval '1 minute'
  where id = v_invite_id;
  delete from public.parent_children where parent_id = v_parent and child_id = v_child;
  perform pg_temp.impersonate('authenticated', v_parent);
  begin
    perform public.preview_parent_child_invite('G16TEST8');
  exception when others then
    v_failed := position('PARENT_INVITE_EXPIRED' in sqlerrm) > 0;
  end;
  if not v_failed then raise exception 'FAIL: expired invitation was accepted'; end if;
  raise notice 'PASS: expired invitations produce a recoverable typed error';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 16 TESTS: ALL PASSED' as result;
