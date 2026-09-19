-- Preserve family access to historical safety records after a child leaves,
-- while keeping archived children out of educator operational workflows.

create or replace function public.can_access_child(p_child_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
      from public.children child
     where child.id = p_child_id
       and (
         (public.is_admin() and child.daycare_id = public.get_my_daycare_id())
         or (
           public.get_my_role() = 'educator'
           and child.daycare_id = public.get_my_daycare_id()
           and child.archived_at is null
           and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
           and child.classroom_id in (select public.my_classroom_ids())
         )
         or (
           public.get_my_role() = 'parent'
           and child.id in (select public.my_child_ids())
         )
       )
  )
$$;

create or replace function public.can_write_child(p_child_id uuid)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select exists (
    select 1
      from public.children child
     where child.id = p_child_id
       and (
         (public.is_admin() and child.daycare_id = public.get_my_daycare_id())
         or (
           public.get_my_role() = 'educator'
           and child.daycare_id = public.get_my_daycare_id()
           and child.archived_at is null
           and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
           and child.classroom_id in (select public.my_classroom_ids())
         )
       )
  )
$$;

create or replace function public.can_access_child_area(
  p_child_id uuid,
  p_area text,
  p_action text default 'view'
)
returns boolean
language sql security definer stable
set search_path = public
as $$
  select case
    when public.get_my_role() = 'parent' then
      p_action = 'view' and p_child_id in (select public.my_child_ids())
    when public.is_admin() then
      public.has_permission(p_area, p_action)
      and exists (
        select 1 from public.children child
         where child.id = p_child_id
           and child.daycare_id = public.get_my_daycare_id()
      )
    when public.get_my_role() = 'educator' then
      public.has_permission(p_area, p_action)
      and exists (
        select 1 from public.children child
         where child.id = p_child_id
           and child.daycare_id = public.get_my_daycare_id()
           and child.archived_at is null
           and coalesce(child.enrolled_on, '-infinity'::date) <= public.center_today()
           and (
             (p_area = 'children' and p_action = 'view')
             or public.can_access_child(child.id)
           )
      )
    else false
  end
$$;

drop policy if exists "read children by area access" on public.children;
create policy "read children by area access" on public.children
  for select
  using (
    (
      public.is_admin()
      and public.has_permission('children', 'view')
      and daycare_id = public.get_my_daycare_id()
    )
    or (
      public.get_my_role() = 'educator'
      and public.has_permission('children', 'view')
      and daycare_id = public.get_my_daycare_id()
      and archived_at is null
      and coalesce(enrolled_on, '-infinity'::date) <= public.center_today()
    )
    or (
      public.get_my_role() = 'parent'
      and id in (select public.my_child_ids())
    )
  );

-- The public wrapper removes staff-only notes and adds director-review state.
-- Its private base must accept a linked archived child so a family can retain
-- the immutable incident record after leaving the center.
create or replace function public.get_parent_incident_hub_group20_base(p_child_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_child public.children%rowtype;
  v_daycare public.daycares%rowtype;
begin
  if auth.uid() is null or public.get_my_role() <> 'parent'
     or p_child_id not in (select public.my_child_ids()) then
    raise exception 'This child is not linked to your family';
  end if;

  select * into v_child
    from public.children child
   where child.id = p_child_id;
  if v_child.id is null then raise exception 'This child is unavailable'; end if;
  select * into v_daycare from public.daycares where id = v_child.daycare_id;

  return jsonb_build_object(
    'daycare', jsonb_build_object('id', v_daycare.id, 'name', v_daycare.name),
    'child', jsonb_build_object(
      'id', v_child.id,
      'first_name', v_child.first_name,
      'last_name', v_child.last_name,
      'photo_url', v_child.photo_url,
      'classroom_id', v_child.classroom_id,
      'classroom_name', (
        select classroom.name from public.classrooms classroom
         where classroom.id = v_child.classroom_id
      )
    ),
    'reports', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', incident.id,
          'child_id', incident.child_id,
          'occurred_at', incident.occurred_at,
          'location', incident.location,
          'severity', incident.severity,
          'injury_type', incident.injury_type,
          'injury_side', incident.injury_side,
          'body_parts', coalesce(to_jsonb(incident.body_parts), '[]'::jsonb),
          'description', incident.description,
          'first_aid_given', incident.first_aid_given,
          'witnesses', coalesce(to_jsonb(incident.witnesses), '[]'::jsonb),
          'notes', incident.notes,
          'photo_paths', coalesce(to_jsonb(incident.photo_paths), '[]'::jsonb),
          'status', incident.status,
          'submitted_at', incident.submitted_at,
          'signed_off_at', incident.signed_off_at,
          'parent_notified_at', incident.parent_notified_at,
          'parent_acknowledged_at', incident.parent_acknowledged_at,
          'parent_acknowledge_name', incident.parent_acknowledge_name,
          'parent_acknowledged_by', incident.parent_acknowledged_by,
          'created_at', incident.created_at,
          'updated_at', incident.updated_at,
          'educator_name', reporter.full_name,
          'signed_off_by_name', director.full_name,
          'action_required', incident.status in ('submitted', 'signed_off')
            and incident.parent_acknowledged_at is null,
          'acknowledgment', case when acknowledgment.id is null then null else
            jsonb_build_object(
              'id', acknowledgment.id,
              'parent_id', acknowledgment.parent_id,
              'signed_name', acknowledgment.signed_name,
              'statement_version', acknowledgment.statement_version,
              'statement_text', acknowledgment.statement_text,
              'acknowledged_at', acknowledgment.acknowledged_at,
              'parent_name', acknowledging_parent.full_name
            ) end
        ) order by
          (incident.status in ('submitted', 'signed_off')
            and incident.parent_acknowledged_at is null) desc,
          incident.occurred_at desc
      )
        from public.incident_reports incident
        left join public.profiles reporter on reporter.id = incident.educator_id
        left join public.profiles director on director.id = incident.signed_off_by
        left join public.incident_acknowledgments acknowledgment
          on acknowledgment.incident_id = incident.id
        left join public.profiles acknowledging_parent
          on acknowledging_parent.id = acknowledgment.parent_id
       where incident.child_id = v_child.id
         and incident.parent_notified_at is not null
         and incident.status in ('submitted', 'signed_off', 'acknowledged')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_parent_incident_hub_group20_base(uuid)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
