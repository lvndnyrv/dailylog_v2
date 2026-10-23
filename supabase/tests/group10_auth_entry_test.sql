-- Rollback-safe Group 10 auth audit and new-center security policy checks.
begin;

do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-000000000001';
  v_educator uuid := '00000000-0000-4000-a000-000000000003';
  v_owner_session uuid := gen_random_uuid();
  v_educator_session uuid := gen_random_uuid();
  v_default text;
begin
  select pg_get_expr(attribute.adbin, attribute.adrelid) into v_default
    from pg_attrdef attribute
    join pg_attribute column_def
      on column_def.attrelid = attribute.adrelid
     and column_def.attnum = attribute.adnum
   where attribute.adrelid = 'public.daycares'::regclass
     and column_def.attname = 'require_admin_mfa';
  if v_default <> 'true' then
    raise exception 'FAIL: newly created centers do not require admin MFA';
  end if;

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (v_owner_session, v_owner, now(), now());
  if not exists (
    select 1 from public.audit_log
    where entity_id = v_owner_session and action = 'sign_in'
      and entity_type = 'account_security' and actor_id = v_owner
  ) then
    raise exception 'FAIL: admin sign-in was not audited';
  end if;

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (v_educator_session, v_educator, now(), now());
  if exists (
    select 1 from public.audit_log
    where entity_id = v_educator_session and action = 'sign_in'
  ) then
    raise exception 'FAIL: educator login appeared in the admin audit log';
  end if;

  update auth.users set encrypted_password =
    extensions.crypt('rollback-only-group10-password', extensions.gen_salt('bf'))
  where id = v_owner;
  if not exists (
    select 1 from public.audit_log
    where entity_id = v_owner and action = 'password_changed'
      and entity_type = 'account_security' and actor_id = v_owner
      and after::text not like '%encrypted_password%'
  ) then
    raise exception 'FAIL: admin password change was not safely audited';
  end if;
end;
$$;

rollback;
select 'PASS: new-center MFA default, admin sign-in and password audit boundaries' as result;
