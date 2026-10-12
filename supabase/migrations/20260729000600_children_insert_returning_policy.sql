-- Group 13 mobile classroom management inserts a child and immediately returns
-- the new row so the educator can finish the child's profile.
--
-- The previous SELECT policy called can_access_child_area(id, ...), which
-- re-queried children by the freshly inserted id. PostgreSQL's command snapshot
-- cannot see that row from the policy's nested query during INSERT ... RETURNING,
-- so an otherwise permitted insert failed with an RLS violation.
--
-- Keep the same center-wide staff roster and parent-link access rules, but
-- evaluate them directly against the row being checked. The DO block also lets
-- this migration be applied atomically by clients that prepare one statement.
do $migration$
begin
  execute 'drop policy if exists "read children by area access" on children';
  execute $policy$
    create policy "read children by area access" on children
      for select
      using (
        (
          is_staff()
          and has_permission('children', 'view')
          and daycare_id = get_my_daycare_id()
        )
        or (
          get_my_role() = 'parent'
          and id in (select my_child_ids())
        )
      )
  $policy$;
end
$migration$;
