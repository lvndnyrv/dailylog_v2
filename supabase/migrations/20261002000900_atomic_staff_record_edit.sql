-- Save the administrator-maintained portion of a staff record atomically.

create or replace function public.admin_update_staff_record(
  p_staff_member_id uuid,
  p_job_title text,
  p_employment_type text,
  p_started_on date,
  p_classroom_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_member public.staff_members%rowtype;
  v_profile public.profiles%rowtype;
  v_job_title text := nullif(btrim(coalesce(p_job_title, '')), '');
  v_employment_type text := nullif(btrim(coalesce(p_employment_type, '')), '');
begin
  if auth.uid() is null or v_daycare_id is null
     or not public.has_permission('staff', 'edit') then
    raise exception 'Staff edit permission is required';
  end if;
  if v_job_title is null then
    raise exception 'Job title is required';
  end if;
  if length(v_job_title) > 120 or v_job_title ~ '[[:cntrl:]]' then
    raise exception 'Job title must be 120 characters or fewer';
  end if;
  if v_employment_type not in ('full_time', 'part_time', 'casual', 'contract') then
    raise exception 'Choose a valid employment type';
  end if;
  if p_classroom_id is not null and not exists (
    select 1 from public.classrooms classroom
     where classroom.id = p_classroom_id
       and classroom.daycare_id = v_daycare_id
       and classroom.archived_at is null
  ) then
    raise exception 'Choose an active classroom in this center';
  end if;

  select member.* into v_member
    from public.staff_members member
   where member.id = p_staff_member_id
     and member.daycare_id = v_daycare_id
   for update;
  if v_member.id is null or v_member.profile_id is null then
    raise exception 'Staff record not found';
  end if;

  select profile.* into v_profile
    from public.profiles profile
   where profile.id = v_member.profile_id
     and profile.daycare_id = v_daycare_id
   for update;
  if v_profile.id is null then
    raise exception 'Staff profile not found';
  end if;

  if v_member.job_title is not distinct from v_job_title
     and v_member.employment_type is not distinct from v_employment_type
     and v_member.started_on is not distinct from p_started_on
     and v_profile.classroom_id is not distinct from p_classroom_id then
    return jsonb_build_object(
      'staff_member_id', v_member.id,
      'profile_id', v_profile.id,
      'changed', false
    );
  end if;

  update public.staff_members
     set job_title = v_job_title,
         employment_type = v_employment_type,
         started_on = p_started_on,
         updated_at = now()
   where id = v_member.id;

  update public.profiles
     set classroom_id = p_classroom_id,
         updated_at = now()
   where id = v_profile.id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, entity_id, before, after
  ) values (
    v_daycare_id,
    auth.uid(),
    'staff_record_updated',
    'staff_record',
    v_member.id,
    jsonb_build_object(
      'profileId', v_profile.id,
      'jobTitle', v_member.job_title,
      'employmentType', v_member.employment_type,
      'startedOn', v_member.started_on,
      'classroomId', v_profile.classroom_id
    ),
    jsonb_build_object(
      'profileId', v_profile.id,
      'jobTitle', v_job_title,
      'employmentType', v_employment_type,
      'startedOn', p_started_on,
      'classroomId', p_classroom_id
    )
  );

  insert into public.notifications (
    daycare_id, profile_id, kind, title, body, payload
  ) values (
    v_daycare_id,
    v_profile.id,
    'staff_record_updated',
    'Employment record updated',
    'An administrator updated your employment details in DailyLog.',
    jsonb_build_object('type', 'staff_record_updated', 'staffMemberId', v_member.id)
  );

  return jsonb_build_object(
    'staff_member_id', v_member.id,
    'profile_id', v_profile.id,
    'changed', true
  );
end;
$$;

revoke all on function public.admin_update_staff_record(uuid, text, text, date, uuid) from public, anon;
grant execute on function public.admin_update_staff_record(uuid, text, text, date, uuid) to authenticated;

comment on function public.admin_update_staff_record(uuid, text, text, date, uuid) is
  'Atomically updates administrator-maintained staff employment and home-classroom details with audit and notification.';
