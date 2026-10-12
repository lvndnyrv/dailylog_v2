-- Keep completed enrollment, child access and first-day activation as one
-- coherent state. Older demo data could mark a pipeline row enrolled without
-- creating the child that educator rosters, attendance and billing require.

do $$
declare
  v_enrollment public.enrollments%rowtype;
  v_child_id uuid := '43000000-0000-4000-a000-000000000002';
begin
  select * into v_enrollment
    from public.enrollments
   where id = '41000000-0000-4000-a000-000000000012'
     and stage = 'enrolled'
     and child_id is null
   for update;

  if v_enrollment.id is not null then
    insert into public.children (
      id, daycare_id, classroom_id, first_name, last_name, date_of_birth,
      allergies, emergency_contacts, enrolled_on, setup_state
    ) values (
      v_child_id, v_enrollment.daycare_id, v_enrollment.classroom_id,
      coalesce(nullif(btrim(v_enrollment.child_first_name), ''), 'Zoé'),
      coalesce(nullif(btrim(v_enrollment.child_last_name), ''), 'Fontaine'),
      v_enrollment.child_date_of_birth,
      case
        when nullif(btrim(v_enrollment.application_data->>'allergy'), '') is null
          then '{}'::text[]
        else array[v_enrollment.application_data->>'allergy']
      end,
      '[]'::jsonb,
      v_enrollment.desired_start_date,
      jsonb_build_object('enrollment_documents_pending', false)
    ) on conflict (id) do update set
      daycare_id = excluded.daycare_id,
      classroom_id = excluded.classroom_id,
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      date_of_birth = excluded.date_of_birth,
      allergies = excluded.allergies,
      emergency_contacts = excluded.emergency_contacts,
      enrolled_on = excluded.enrolled_on,
      archived_at = null;

    update public.enrollments
       set child_id = v_child_id,
           application_submitted_at = coalesce(application_submitted_at, stage_changed_at - interval '3 days'),
           agreement_version = coalesce(agreement_version, 'seed-demo-v1'),
           agreement_signed_at = coalesce(agreement_signed_at, stage_changed_at - interval '2 days'),
           offer_accepted_at = coalesce(offer_accepted_at, stage_changed_at - interval '1 day'),
           deposit_status = 'paid',
           deposit_paid_at = coalesce(deposit_paid_at, stage_changed_at - interval '1 day'),
           parent_workflow_step = 'enrolled',
           onboarding_steps = (coalesce(onboarding_steps, '{}'::jsonb) - 'room_schedule')
             || jsonb_build_object('offer_complete', true, 'account_linked', false)
     where id = v_enrollment.id;
  end if;
end;
$$;

create or replace function public.enforce_enrollment_child_activation_boundary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child public.children%rowtype;
begin
  if new.stage <> 'enrolled' then return new; end if;

  if new.child_id is null or new.classroom_id is null or new.desired_start_date is null then
    raise exception 'An enrolled family requires a linked child, room and first day';
  end if;

  select * into v_child
    from public.children child
   where child.id = new.child_id;

  if v_child.id is null or v_child.daycare_id <> new.daycare_id then
    raise exception 'The linked child must belong to this center';
  end if;
  if v_child.archived_at is not null then
    raise exception 'Restore the linked child before completing enrollment';
  end if;
  if v_child.classroom_id is distinct from new.classroom_id then
    raise exception 'The linked child and enrollment room must match';
  end if;
  if v_child.enrolled_on is distinct from new.desired_start_date then
    raise exception 'The linked child and enrollment first day must match';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_enrollment_child_activation_boundary
  on public.enrollments;
create trigger enforce_enrollment_child_activation_boundary
  before insert or update of stage, child_id, classroom_id, desired_start_date
  on public.enrollments
  for each row execute function public.enforce_enrollment_child_activation_boundary();

alter table public.enrollments
  drop constraint if exists enrollments_enrolled_child_required;
alter table public.enrollments
  add constraint enrollments_enrolled_child_required
  check (
    stage <> 'enrolled'
    or (child_id is not null and classroom_id is not null and desired_start_date is not null)
  );

revoke all on function public.enforce_enrollment_child_activation_boundary()
  from public, anon, authenticated;

notify pgrst, 'reload schema';
