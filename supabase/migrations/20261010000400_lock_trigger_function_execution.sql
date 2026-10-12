-- Trigger functions are implementation details, not RPC endpoints. PostgreSQL
-- grants EXECUTE on new functions to PUBLIC unless explicitly revoked, which
-- also made these routines appear callable to API roles. Triggers continue to
-- run normally after direct execution is removed.

do $$
declare
  v_function record;
begin
  for v_function in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke execute on function %s from public, anon, authenticated',
      v_function.signature
    );
  end loop;
end;
$$;
