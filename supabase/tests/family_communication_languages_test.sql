-- Rollback-safe Group 5 family language and localized broadcast checks.
begin;

create or replace function pg_temp.impersonate(p_role text, p_user uuid default null)
returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user,
      'role', case when p_role = 'postgres' then 'service_role' else p_role end
    )::text,
    true
  );
  perform set_config('role', p_role, true);
end $$;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_parent uuid := '00000000-0000-4000-a000-000000000023';
  v_daycare uuid := '10000000-0000-4000-a000-000000000001';
  v_announcement uuid;
  v_conversation uuid;
  v_payload jsonb;
  v_requested text[];
  v_ready text[];
  v_missing text[];
begin
  perform pg_temp.impersonate('authenticated', v_owner);
  insert into public.announcements (
    daycare_id, author_id, title, body, audience_type, published_at
  ) values (
    v_daycare, v_owner, 'Tomorrow is photo day', 'Please arrive by 9 AM.',
    'families', now()
  ) returning id into v_announcement;

  insert into public.announcement_translations (
    announcement_id, language_code, title, body, provider
  ) values (
    v_announcement, 'fr', 'Demain, c''est la journée photo',
    'Veuillez arriver avant 9 h.', 'test'
  );

  select delivery.conversation_id into v_conversation
    from public.announcement_thread_deliveries delivery
    join public.conversations conversation on conversation.id = delivery.conversation_id
    join public.parent_children parent_link on parent_link.child_id = conversation.child_id
   where delivery.announcement_id = v_announcement
     and parent_link.parent_id = v_parent
   limit 1;

  perform pg_temp.impersonate('authenticated', v_parent);
  if public.set_my_preferred_language('fr') <> 'fr' then
    raise exception 'FAIL: parent communication language was not saved';
  end if;

  v_payload := public.get_my_localized_announcements(50, v_announcement);
  if jsonb_array_length(v_payload) <> 1
     or v_payload -> 0 ->> 'title' <> 'Demain, c''est la journée photo'
     or v_payload -> 0 ->> 'body' <> 'Veuillez arriver avant 9 h.'
     or (v_payload -> 0 ->> 'is_translated')::boolean is not true then
    raise exception 'FAIL: parent announcement feed did not use the French copy: %', v_payload;
  end if;

  if not exists (
    select 1
      from public.get_family_conversation_timeline(v_conversation) timeline
     where timeline.announcement_id = v_announcement
       and timeline.title = 'Demain, c''est la journée photo'
       and timeline.body = 'Veuillez arriver avant 9 h.'
  ) then
    raise exception 'FAIL: parent conversation did not use the French copy';
  end if;

  perform public.set_my_preferred_language('es');
  v_payload := public.get_my_localized_announcements(50, v_announcement);
  if v_payload -> 0 ->> 'title' <> 'Tomorrow is photo day'
     or (v_payload -> 0 ->> 'is_translated')::boolean is true
     or v_payload -> 0 ->> 'language_code' <> 'en' then
    raise exception 'FAIL: missing translation did not fall back to source copy: %', v_payload;
  end if;

  perform pg_temp.impersonate('authenticated', v_owner);
  select metric.requested_languages, metric.ready_languages, metric.missing_languages
    into v_requested, v_ready, v_missing
    from public.list_broadcast_language_metrics(array[v_announcement]) metric;
  if array_position(v_requested, 'en') is null
     or array_position(v_requested, 'es') is null
     or array_position(v_ready, 'en') is null
     or array_position(v_missing, 'es') is null then
    raise exception 'FAIL: admin language readiness metric is incorrect: requested %, ready %, missing %',
      v_requested, v_ready, v_missing;
  end if;
end $$;

rollback;
select 'PASS: family language preference localizes feeds and conversations with safe fallback' as result;
