begin;

do $$
declare
  v_exposed text;
begin
  select string_agg(
    procedure.oid::regprocedure::text,
    ', ' order by procedure.proname
  ) into v_exposed
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.prorettype = 'trigger'::regtype
    and (
      has_function_privilege('anon', procedure.oid, 'EXECUTE')
      or has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    );

  if v_exposed is not null then
    raise exception 'FAIL: trigger functions remain directly executable: %', v_exposed;
  end if;
end;
$$;

rollback;
select 'PASS: trigger functions cannot be invoked directly by API roles' as result;
