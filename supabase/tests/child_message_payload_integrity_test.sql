-- Child-message text and attachment integrity. All mutations roll back.
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
  v_parent constant uuid := '00000000-0000-4000-a000-000000000023';
  v_child constant uuid := '30000000-0000-4000-a000-000000000013';
  v_conversation uuid;
  v_message uuid := gen_random_uuid();
  v_failed boolean;
  v_policy text;
begin
  perform pg_temp.impersonate('authenticated', v_parent);
  v_conversation := public.get_or_create_child_conversation(v_child);

  insert into public.messages (
    id, daycare_id, conversation_id, child_id, sender_id, body
  ) values (
    v_message, v_daycare, v_conversation, v_child, v_parent, '  Safe family update  '
  );
  if (select body from public.messages where id = v_message) <> 'Safe family update' then
    raise exception 'FAIL: child message text was not normalized';
  end if;
  raise notice 'PASS: valid child messages are normalized and accepted';

  v_failed := false;
  begin
    insert into public.messages (
      daycare_id, conversation_id, child_id, sender_id, body
    ) values (
      v_daycare, v_conversation, v_child, v_parent, '   '
    );
  exception when others then
    v_failed := position('text is required' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'FAIL: blank child message was accepted';
  end if;

  v_failed := false;
  begin
    insert into public.messages (
      daycare_id, conversation_id, child_id, sender_id, body
    ) values (
      v_daycare, v_conversation, v_child, v_parent, repeat('x', 4001)
    );
  exception when others then
    v_failed := position('4000 characters' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'FAIL: oversized child message was accepted';
  end if;
  raise notice 'PASS: blank and oversized child messages are rejected';

  v_message := gen_random_uuid();
  v_failed := false;
  begin
    insert into public.messages (
      id, daycare_id, conversation_id, child_id, sender_id, body,
      attachment_kind, attachment_path, attachment_name, attachment_mime
    ) values (
      v_message, v_daycare, v_conversation, v_child, v_parent, 'Document',
      'document',
      v_child::text || '/00000000-0000-4000-a000-000000000024/' || v_message::text || '/form.pdf',
      'form.pdf', 'application/pdf'
    );
  exception when others then
    v_failed := position('does not match this message' in sqlerrm) > 0;
  end;
  if not v_failed then
    raise exception 'FAIL: attachment path belonging to another sender was accepted';
  end if;

  v_message := gen_random_uuid();
  insert into public.messages (
    id, daycare_id, conversation_id, child_id, sender_id, body,
    attachment_kind, attachment_path, attachment_name, attachment_mime
  ) values (
    v_message, v_daycare, v_conversation, v_child, v_parent, 'Document',
    'document',
    v_child::text || '/' || v_parent::text || '/' || v_message::text || '/form.pdf',
    'form.pdf', 'application/pdf'
  );
  raise notice 'PASS: attachment metadata is bound to its child, sender, and message';

  perform pg_temp.impersonate('postgres');
  select policy.with_check into v_policy
    from pg_policies policy
   where policy.schemaname = 'storage'
     and policy.tablename = 'objects'
     and policy.policyname = 'participants upload message attachments';
  if v_policy is null
     or position('auth.uid()' in v_policy) = 0
     or position('split_part' in v_policy) = 0 then
    raise exception 'FAIL: storage upload policy is not bound to the signed-in sender path';
  end if;
  raise notice 'PASS: private attachment uploads are bound to the signed-in sender path';
end;
$$;

rollback;
select 'CHILD MESSAGE PAYLOAD INTEGRITY TESTS: ALL PASSED' as result;
