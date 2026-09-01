-- ============================================================================
-- Parent mobile Group 22: child details drill-in
-- The account design links each child card to a details page. Keep the payload
-- behind a parent-scoped RPC so care notes never leak across families.
-- ============================================================================

create or replace function public.get_parent_child_details(p_child_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'A signed-in parent account is required';
  end if;

  select jsonb_build_object(
    'id', child.id,
    'first_name', child.first_name,
    'last_name', child.last_name,
    'preferred_name', child.preferred_name,
    'pronouns', child.pronouns,
    'date_of_birth', child.date_of_birth,
    'photo_url', child.photo_url,
    'classroom_name', room.name,
    'center_name', center.name,
    'enrolled_on', child.enrolled_on,
    'allergies', coalesce(to_jsonb(child.allergies), '[]'::jsonb),
    'dietary_needs', child.dietary_needs,
    'medical_notes', child.medical_notes,
    'emergency_contacts', coalesce(child.emergency_contacts, '[]'::jsonb),
    'guardians', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', guardian.id,
        'full_name', guardian.full_name,
        'relationship', link.relationship,
        'is_primary', link.is_primary,
        'is_current_user', guardian.id = auth.uid()
      ) order by link.is_primary desc, guardian.full_name)
      from public.parent_children link
      join public.profiles guardian on guardian.id = link.parent_id
      where link.child_id = child.id
        and guardian.archived_at is null
    ), '[]'::jsonb)
  )
  into v_result
  from public.children child
  join public.parent_children mine
    on mine.child_id = child.id
   and mine.parent_id = auth.uid()
  join public.profiles parent
    on parent.id = mine.parent_id
   and parent.role = 'parent'
   and parent.archived_at is null
  left join public.classrooms room on room.id = child.classroom_id
  left join public.daycares center on center.id = child.daycare_id
  where child.id = p_child_id
    and child.archived_at is null;

  if v_result is null then
    raise exception 'This child is not linked to your family';
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_parent_child_details(uuid) from public, anon;
grant execute on function public.get_parent_child_details(uuid) to authenticated;
