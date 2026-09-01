-- Mobile Parent Group 18 messaging tests. All mutations roll back.
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
  v_daycare constant uuid := '10000000-0000-4000-a000-000000000001';
  v_owner constant uuid := '00000000-0000-4000-a000-000000000001';
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_other_parent constant uuid := '00000000-0000-4000-a000-000000000024';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_other_child constant uuid := '30000000-0000-4000-a000-000000000014';
  v_conversation uuid;
  v_retry uuid;
  v_other_conversation uuid;
  v_message uuid := gen_random_uuid();
  v_failed boolean := false;
begin
  perform pg_temp.impersonate('authenticated', v_parent);
  v_conversation := public.get_or_create_child_conversation(v_child);
  v_retry := public.get_or_create_child_conversation(v_child);

  if v_conversation is null or v_retry <> v_conversation then
    raise exception 'FAIL: conversation creation was not idempotent';
  end if;
  if (
    select count(*)
    from public.conversations
    where child_id = v_child and kind = 'direct' and archived_at is null
  ) <> 1 then
    raise exception 'FAIL: more than one active direct conversation exists';
  end if;
  raise notice 'PASS: linked family gets one durable child conversation';

  insert into public.messages (
    id, daycare_id, conversation_id, child_id, sender_id, body
  ) values (
    v_message, v_daycare, v_conversation, v_child, v_parent, 'Group 18 read receipt test'
  );

  perform pg_temp.impersonate('authenticated', v_owner);
  perform public.mark_messages_read(v_child);
  if not exists (
    select 1 from public.messages
    where id = v_message and read_at is not null
  ) then
    raise exception 'FAIL: recipient read receipt was not persisted';
  end if;
  raise notice 'PASS: recipient reads persist for live sender updates';

  v_other_conversation := public.get_or_create_child_conversation(v_other_child);
  v_failed := false;
  begin
    insert into public.messages (
      daycare_id, conversation_id, child_id, sender_id, body
    ) values (
      v_daycare, v_other_conversation, v_child, v_owner, 'Mismatched thread'
    );
  exception when others then
    v_failed := position('does not match' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'FAIL: message crossed child conversation boundaries';
  end if;
  raise notice 'PASS: database rejects child/conversation mismatches';

  v_failed := false;
  begin
    insert into public.conversations (daycare_id, child_id, kind)
    values (v_daycare, v_child, 'direct');
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: duplicate active direct conversation was created';
  end if;
  raise notice 'PASS: concurrent clients cannot create duplicate direct threads';

  v_failed := false;
  begin
    insert into public.conversations (daycare_id, child_id, kind)
    values (gen_random_uuid(), v_other_child, 'direct');
  exception when others then
    v_failed := position('center does not match' in sqlerrm) > 0
      or position('same center' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'FAIL: conversation claimed a center different from its child';
  end if;
  raise notice 'PASS: direct conversation center is derived from the child boundary';

  perform pg_temp.impersonate('authenticated', v_other_parent);
  v_failed := false;
  begin
    perform public.get_or_create_child_conversation(v_child);
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: unrelated parent opened another family conversation';
  end if;
  raise notice 'PASS: unrelated families cannot open a child conversation';
end;
$$;

rollback;
select 'MOBILE PARENT GROUP 18 TESTS: ALL PASSED' as result;
