-- Broadcast editors need draft access, but view-only educators must not see a
-- scheduled or cancelled staff announcement before it is actually delivered.

drop policy if exists "members read permitted announcements"
  on public.announcements;
create policy "members read permitted announcements"
  on public.announcements for select using (
    (
      public.is_staff()
      and public.has_permission('broadcasts', 'view')
      and daycare_id = public.get_my_daycare_id()
      and (
        public.has_permission('broadcasts', 'edit')
        or (
          published_at is not null
          and published_at <= now()
          and cancelled_at is null
        )
      )
    )
    or (
      public.get_my_role() = 'parent'
      and audience_type = 'families'
      and published_at is not null
      and published_at <= now()
      and cancelled_at is null
      and daycare_id in (
        select child.daycare_id
          from public.children child
         where child.id in (select public.my_child_ids())
      )
      and (
        classroom_id is null
        or classroom_id in (
          select child.classroom_id
            from public.children child
           where child.id in (select public.my_child_ids())
        )
      )
    )
  );

notify pgrst, 'reload schema';
