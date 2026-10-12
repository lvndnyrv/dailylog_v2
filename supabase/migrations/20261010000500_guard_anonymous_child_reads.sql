-- Anonymous roster reads should resolve to an empty result through RLS rather
-- than attempting to execute authenticated-only permission helpers. Keep the
-- helper private and make the policy's unauthenticated branch explicit.

drop policy if exists "read children by area access" on public.children;

create policy "read children by area access"
on public.children
for select
using (
  case
    when auth.uid() is null then false
    else (
      (
        public.is_admin()
        and daycare_id = public.get_my_daycare_id()
        and public.has_permission_for_classroom('children', 'view', classroom_id)
      )
      or (
        public.get_my_role() = 'educator'
        and daycare_id = public.get_my_daycare_id()
        and archived_at is null
        and coalesce(enrolled_on, '-infinity'::date) <= public.center_today()
        and public.has_permission_for_classroom('children', 'view', classroom_id)
      )
      or (
        public.get_my_role() = 'parent'
        and id in (select public.my_child_ids())
      )
    )
  end
);

