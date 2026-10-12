-- Keep privacy-request handling identical across the web console and mobile
-- admin app. The transition is center-scoped, concurrency-safe and records
-- the administrator and optional office note in one atomic update.

create or replace function public.transition_parent_data_request(
  p_request_id uuid,
  p_expected_status text,
  p_next_status text,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.profiles%rowtype;
  v_request public.parent_data_requests%rowtype;
begin
  select * into v_admin
  from public.profiles
  where id = auth.uid()
    and role in ('owner_admin', 'admin')
    and archived_at is null;

  if v_admin.id is null or v_admin.daycare_id is null then
    raise exception 'An active administrator account is required';
  end if;

  if not (
    (p_expected_status = 'requested' and p_next_status = 'processing')
    or (p_expected_status = 'processing' and p_next_status = 'completed')
  ) then
    raise exception 'Unsupported privacy request transition';
  end if;

  update public.parent_data_requests request
  set status = p_next_status,
      handled_by = v_admin.id,
      completed_at = case when p_next_status = 'completed' then now() else null end,
      notes = case
        when nullif(btrim(coalesce(p_notes, '')), '') is not null
          then left(btrim(p_notes), 2000)
        else request.notes
      end
  where request.id = p_request_id
    and request.daycare_id = v_admin.daycare_id
    and request.status = p_expected_status
  returning * into v_request;

  if v_request.id is null then
    raise exception 'This privacy request changed or is not available to your center';
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'request_type', v_request.request_type,
    'status', v_request.status,
    'handled_by', v_request.handled_by,
    'completed_at', v_request.completed_at,
    'notes', v_request.notes,
    'updated_at', v_request.updated_at
  );
end;
$$;

revoke all on function public.transition_parent_data_request(uuid, text, text, text) from public;
grant execute on function public.transition_parent_data_request(uuid, text, text, text) to authenticated;
