-- ============================================================================
-- Educator mobile Group 11 — daily meal menus and pre-filled meal logging
-- ============================================================================

create table meal_menu_items (
  id uuid primary key default gen_random_uuid(),
  daycare_id uuid not null references daycares(id) on delete cascade,
  classroom_id uuid references classrooms(id) on delete cascade,
  menu_date date not null,
  meal_type text not null check (
    meal_type in ('morning_snack', 'lunch', 'afternoon_snack')
  ),
  meal_label text not null,
  meal_time time not null,
  food_description text not null,
  allergens text[] not null default '{}',
  created_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(trim(meal_label)) > 0),
  check (length(trim(food_description)) > 0)
);

-- A null classroom means the item applies to every room. PostgreSQL otherwise
-- treats nulls as distinct, so use a sentinel only inside the unique index.
create unique index meal_menu_items_scope_meal_unique
  on meal_menu_items (
    daycare_id,
    coalesce(classroom_id, '00000000-0000-0000-0000-000000000000'::uuid),
    menu_date,
    meal_type
  );
create index meal_menu_items_date_idx
  on meal_menu_items (daycare_id, menu_date, classroom_id);

create trigger meal_menu_items_updated_at
  before update on meal_menu_items
  for each row execute function update_updated_at();

alter table meal_entries
  add column meal_menu_item_id uuid references meal_menu_items(id) on delete set null;

-- Re-logging a scheduled meal updates the amount instead of duplicating it.
create unique index meal_entries_menu_item_unique
  on meal_entries (daily_log_id, meal_menu_item_id);

alter table meal_menu_items enable row level security;

create policy "staff read center meal menus"
  on meal_menu_items for select
  using (
    is_staff()
    and has_permission('daily_logs', 'view')
    and daycare_id = get_my_daycare_id()
  );

create policy "parents read linked classroom meal menus"
  on meal_menu_items for select
  using (
    get_my_role() = 'parent'
    and daycare_id in (
      select c.daycare_id
      from children c
      where c.id in (select my_child_ids())
    )
    and (
      classroom_id is null
      or classroom_id in (
        select c.classroom_id
        from children c
        where c.id in (select my_child_ids())
      )
    )
  );

create policy "staff create center meal menus"
  on meal_menu_items for insert
  with check (
    is_staff()
    and has_permission('daily_logs', 'edit')
    and daycare_id = get_my_daycare_id()
    and created_by = auth.uid()
  );

create policy "staff update center meal menus"
  on meal_menu_items for update
  using (
    is_staff()
    and has_permission('daily_logs', 'edit')
    and daycare_id = get_my_daycare_id()
  )
  with check (
    is_staff()
    and has_permission('daily_logs', 'edit')
    and daycare_id = get_my_daycare_id()
  );

create policy "staff delete center meal menus"
  on meal_menu_items for delete
  using (
    is_staff()
    and has_permission('daily_logs', 'edit')
    and daycare_id = get_my_daycare_id()
  );

create or replace function save_meal_menu_day(
  p_menu_date date,
  p_classroom_id uuid,
  p_items jsonb
)
returns setof meal_menu_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := get_my_daycare_id();
begin
  if not is_staff() or not has_permission('daily_logs', 'edit') then
    raise exception 'You do not have permission to edit meal menus';
  end if;

  if p_menu_date is null then
    raise exception 'Choose a menu date';
  end if;

  if p_classroom_id is not null and not exists (
    select 1
    from classrooms c
    where c.id = p_classroom_id
      and c.daycare_id = v_daycare_id
  ) then
    raise exception 'Choose a classroom from your center';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Menu items must be an array';
  end if;

  delete from meal_menu_items item
  where item.daycare_id = v_daycare_id
    and item.menu_date = p_menu_date
    and item.classroom_id is not distinct from p_classroom_id;

  insert into meal_menu_items (
    daycare_id,
    classroom_id,
    menu_date,
    meal_type,
    meal_label,
    meal_time,
    food_description,
    allergens,
    created_by
  )
  select
    v_daycare_id,
    p_classroom_id,
    p_menu_date,
    source.meal_type,
    trim(source.meal_label),
    source.meal_time,
    trim(source.food_description),
    coalesce(source.allergens, '{}'::text[]),
    auth.uid()
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as source(
    meal_type text,
    meal_label text,
    meal_time time,
    food_description text,
    allergens text[]
  )
  where source.meal_type in ('morning_snack', 'lunch', 'afternoon_snack')
    and length(trim(coalesce(source.meal_label, ''))) > 0
    and length(trim(coalesce(source.food_description, ''))) > 0;

  return query
    select item.*
    from meal_menu_items item
    where item.daycare_id = v_daycare_id
      and item.menu_date = p_menu_date
      and item.classroom_id is not distinct from p_classroom_id
    order by item.meal_time, item.meal_type;
end;
$$;

revoke all on function save_meal_menu_day(date, uuid, jsonb) from public, anon;
grant execute on function save_meal_menu_day(date, uuid, jsonb) to authenticated;

alter publication supabase_realtime add table meal_menu_items;
