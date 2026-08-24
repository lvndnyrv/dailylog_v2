-- Keep older mobile clients compatible while routing redemption through the
-- Group 16 validation and explicit-consent implementation.
create or replace function public.link_child_with_code(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.accept_parent_child_invite(p_code, 'Parent');
  return (v_result->>'child_id')::uuid;
end;
$$;

revoke all on function public.link_child_with_code(text) from public, anon;
grant execute on function public.link_child_with_code(text) to authenticated;

comment on function public.link_child_with_code(text) is
  'Legacy wrapper for older clients. Uses the hardened Group 16 redemption path and leaves privacy consent pending.';
