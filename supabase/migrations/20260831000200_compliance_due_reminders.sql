-- Return actionable center deadlines without loading the full inspection pack
-- on the dashboard. Latest non-voided drill of each kind owns its next due date.
create function public._compliance_due_items(p_daycare uuid)
returns table(id uuid,title text,due_on date,kind text,days_left integer)
language sql stable security definer set search_path=public as $$
  with center as (
    select (now() at time zone coalesce(timezone,'UTC'))::date as today from public.daycares where id=p_daycare
  ), latest_drills as (
    select distinct on (d.kind) d.id,d.kind,d.next_due_on from public.compliance_drills d
      where d.daycare_id=p_daycare and d.voided_at is null order by d.kind,d.conducted_at desc,d.created_at desc
  )
  select d.id,d.title,d.expires_on,'document'::text,d.expires_on-c.today
    from public.compliance_documents d cross join center c
    where d.daycare_id=p_daycare and d.watch_expiry and d.expires_on<=c.today+60
      and not exists(select 1 from public.compliance_documents n where n.replaces_id=d.id)
  union all
  select d.id,initcap(replace(d.kind,'_',' '))||' drill',d.next_due_on,'drill',d.next_due_on-c.today
    from latest_drills d cross join center c where d.next_due_on<=c.today+7;
$$;
create function public.list_compliance_due_items()
returns table(id uuid,title text,due_on date,kind text,days_left integer)
language sql stable security definer set search_path=public as $$
  select d.* from public._compliance_due_items(public.get_my_daycare_id()) d
    where public.is_admin() order by d.due_on,d.title;
$$;
create function public.enqueue_compliance_due_reminders()
returns integer language plpgsql security definer set search_path=public as $$
declare v_center record; v_item record; v_profile record; v_key text; v_count integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'Service role required'; end if;
  for v_center in select id from public.daycares loop
    for v_item in select * from public._compliance_due_items(v_center.id) loop
      for v_profile in select id from public.profiles where daycare_id=v_center.id and role in ('owner_admin','admin') and archived_at is null loop
        v_key:='compliance:'||v_item.id::text||':'||v_item.due_on::text||':'||
          case when v_item.days_left<0 then 'overdue' when v_item.days_left=0 then 'today'
            when v_item.days_left<=7 then '7' when v_item.days_left<=30 then '30' else '60' end;
        -- Catch up if a worker run was missed; deduplicate each threshold.
        perform pg_advisory_xact_lock(hashtextextended(v_profile.id::text||v_key,0));
        if not exists(select 1 from public.notifications where profile_id=v_profile.id and payload->>'dedupeKey'=v_key) then
          insert into public.notifications(daycare_id,profile_id,kind,title,body,payload)
          values(v_center.id,v_profile.id,'compliance_due',v_item.title||case when v_item.days_left<0 then ' is overdue'
            when v_item.days_left=0 then ' is due today' else ' is due in '||v_item.days_left||' days' end,
            'Review the record and next steps in Compliance.',jsonb_build_object('category','compliance','source','Compliance',
              'href','/compliance','action_label','Review compliance','severity',case when v_item.days_left<0 then 'critical' else 'warning' end,
              'dedupeKey',v_key));
          v_count:=v_count+1;
        end if;
      end loop;
    end loop;
  end loop;
  return v_count;
end $$;
revoke all on function public._compliance_due_items(uuid) from public,anon,authenticated;
revoke all on function public.list_compliance_due_items() from public,anon;
revoke all on function public.enqueue_compliance_due_reminders() from public,anon,authenticated;
grant execute on function public.list_compliance_due_items() to authenticated;
grant execute on function public.enqueue_compliance_due_reminders() to service_role;
