-- Payroll entries for one staff member must never overlap. The mobile clock-in
-- path already prevents two open timers, but manual/admin entries and future
-- closed entries could still overlap and inflate the weekly total.

create extension if not exists btree_gist with schema extensions;

alter table public.staff_time_entries
  add constraint staff_time_entries_no_overlap
  exclude using gist (
    staff_member_id with =,
    tstzrange(
      clocked_in_at,
      coalesce(clocked_out_at, 'infinity'::timestamptz),
      '[)'
    ) with &&
  );
