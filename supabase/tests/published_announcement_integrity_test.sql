-- Rollback-safe delivered-announcement integrity test.

begin;

do $$
declare
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_published uuid := gen_random_uuid();
  v_scheduled uuid := gen_random_uuid();
  v_failed boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_owner,
    'role', 'authenticated'
  )::text, true);

  insert into public.announcements (
    id, daycare_id, author_id, title, body, audience_type, published_at
  ) values (
    v_published, v_daycare, v_owner, 'Delivered record', 'Original family message',
    'families', now()
  );

  v_failed := false;
  begin
    update public.announcements
       set body = 'Silently rewritten'
     where id = v_published;
  exception when others then
    v_failed := sqlerrm like '%cannot be edited%';
  end;
  if not v_failed then
    raise exception 'FAIL: authenticated staff rewrote a delivered announcement';
  end if;

  v_failed := false;
  begin
    delete from public.announcements where id = v_published;
  exception when others then
    v_failed := sqlerrm like '%cannot be deleted%';
  end;
  if not v_failed then
    raise exception 'FAIL: authenticated staff deleted a delivered announcement';
  end if;

  if not exists (
    select 1 from public.announcements
     where id = v_published
       and body = 'Original family message'
  ) then
    raise exception 'FAIL: delivered announcement history changed';
  end if;

  insert into public.announcements (
    id, daycare_id, author_id, title, body, audience_type,
    scheduled_for, published_at
  ) values (
    v_scheduled, v_daycare, v_owner, 'Unsent draft', 'Safe to remove before delivery',
    'families', now() + interval '1 day', null
  );

  delete from public.announcements where id = v_scheduled;
  if exists (select 1 from public.announcements where id = v_scheduled) then
    raise exception 'FAIL: unpublished scheduled draft could not be removed';
  end if;

  raise notice 'PASS: delivered announcements are immutable while unpublished drafts remain removable';
end;
$$;

rollback;
