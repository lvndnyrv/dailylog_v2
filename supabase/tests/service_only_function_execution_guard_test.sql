-- Scheduler and notification internals must never be client-callable.
begin;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.enqueue_system_medication_notification(uuid,text,text,jsonb,text)',
    'public.process_medication_authorization_statuses()',
    'public.process_overdue_waitlist_checkins()'
  ]
  loop
    if has_function_privilege('anon', v_signature, 'EXECUTE') then
      raise exception 'FAIL: anon can execute %', v_signature;
    end if;
    if has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'FAIL: authenticated can execute %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'FAIL: service_role cannot execute %', v_signature;
    end if;
  end loop;

  raise notice 'PASS: scheduler and medication notification internals are service-only';
end;
$$;

rollback;

