-- Cross-role message read receipts. All mutations roll back.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user_id uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('role', p_role, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user_id,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
end;
$$;

do $$
declare
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_educator constant uuid := '00000000-0000-4000-a000-000000000003';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_conversation uuid;
  v_message uuid := gen_random_uuid();
  v_count bigint;
begin
  perform pg_temp.impersonate('authenticated', v_parent);
  v_conversation := public.get_or_create_child_conversation(v_child);
  insert into public.messages (
    id, daycare_id, conversation_id, child_id, sender_id, body
  ) values (
    v_message, v_daycare, v_conversation, v_child, v_parent,
    'Rollback-only recipient receipt check'
  );

  perform pg_temp.impersonate('authenticated', v_educator);
  select unread.unread_count into v_count
  from public.get_unread_child_message_counts(array[v_child]) unread
  where unread.child_id = v_child;
  if coalesce(v_count, 0) < 1 then
    raise exception 'FAIL: assigned educator did not receive an unread family message';
  end if;
  perform public.mark_messages_read(v_child);

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.message_reads receipt
    where receipt.message_id = v_message and receipt.profile_id = v_educator
  ) then
    raise exception 'FAIL: educator read receipt was not stored';
  end if;
  if exists (
    select 1 from public.message_reads receipt
    where receipt.message_id = v_message and receipt.profile_id = v_owner
  ) then
    raise exception 'FAIL: educator read incorrectly cleared the owner inbox';
  end if;
  raise notice 'PASS: one staff member cannot clear another staff member inbox';

  perform pg_temp.impersonate('authenticated', v_owner);
  select unread.unread_count into v_count
  from public.get_unread_child_message_counts(array[v_child]) unread
  where unread.child_id = v_child;
  if coalesce(v_count, 0) < 1 then
    raise exception 'FAIL: owner lost unread state after educator opened the thread';
  end if;
  perform public.mark_messages_read(v_child);

  perform pg_temp.impersonate('postgres');
  if not exists (
    select 1 from public.message_reads receipt
    where receipt.message_id = v_message and receipt.profile_id = v_owner
  ) then
    raise exception 'FAIL: owner read receipt was not stored';
  end if;
  raise notice 'PASS: each eligible recipient owns an independent read receipt';
end;
$$;

rollback;
select 'MESSAGE RECIPIENT READ RECEIPTS: ALL PASSED' as result;
