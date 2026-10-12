-- Make menu planning and the educator meal handoff atomic, room-scoped and
-- allergy-safe. Direct table writes follow the same room boundary as the RPC.

drop policy if exists "staff read center meal menus" on public.meal_menu_items;
create policy "staff read accessible meal menus"
  on public.meal_menu_items for select
  using (
    public.is_staff()
    and public.has_permission('daily_logs', 'view')
    and daycare_id = public.get_my_daycare_id()
    and (
      public.is_admin()
      or classroom_id is null
      or classroom_id in (select public.my_classroom_ids())
    )
  );

drop policy if exists "staff create center meal menus" on public.meal_menu_items;
create policy "staff create accessible meal menus"
  on public.meal_menu_items for insert
  with check (
    public.is_staff()
    and public.has_permission('daily_logs', 'edit')
    and daycare_id = public.get_my_daycare_id()
    and created_by = auth.uid()
    and (
      public.is_admin()
      or (
        public.get_my_role() = 'educator'
        and classroom_id in (select public.my_classroom_ids())
      )
    )
  );

drop policy if exists "staff update center meal menus" on public.meal_menu_items;
create policy "staff update accessible meal menus"
  on public.meal_menu_items for update
  using (
    public.is_staff()
    and public.has_permission('daily_logs', 'edit')
    and daycare_id = public.get_my_daycare_id()
    and (
      public.is_admin()
      or (
        public.get_my_role() = 'educator'
        and classroom_id in (select public.my_classroom_ids())
      )
    )
  )
  with check (
    public.is_staff()
    and public.has_permission('daily_logs', 'edit')
    and daycare_id = public.get_my_daycare_id()
    and (
      public.is_admin()
      or (
        public.get_my_role() = 'educator'
        and classroom_id in (select public.my_classroom_ids())
      )
    )
  );

drop policy if exists "staff delete center meal menus" on public.meal_menu_items;
create policy "staff delete accessible meal menus"
  on public.meal_menu_items for delete
  using (
    public.is_staff()
    and public.has_permission('daily_logs', 'edit')
    and daycare_id = public.get_my_daycare_id()
    and (
      public.is_admin()
      or (
        public.get_my_role() = 'educator'
        and classroom_id in (select public.my_classroom_ids())
      )
    )
  );

create or replace function public.save_meal_menu_day(
  p_menu_date date,
  p_classroom_id uuid,
  p_items jsonb
)
returns setof public.meal_menu_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare_id uuid := public.get_my_daycare_id();
  v_before jsonb;
  v_after jsonb;
  v_item jsonb;
  v_types text[] := array[]::text[];
  v_type text;
  v_label text;
  v_food text;
  v_allergens text[];
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('daily_logs', 'edit') then
    raise exception 'You do not have permission to edit meal menus';
  end if;
  if p_menu_date is null then raise exception 'Choose a menu date'; end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Menu items must be an array';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 3 then
    raise exception 'A daily menu can contain no more than three meals';
  end if;

  if p_classroom_id is null then
    if not public.is_admin() then
      raise exception 'Only administrators can change the all-rooms menu';
    end if;
  elsif not exists (
    select 1 from public.classrooms room
     where room.id = p_classroom_id
       and room.daycare_id = v_daycare_id
       and room.archived_at is null
       and (
         public.is_admin()
         or (
           public.get_my_role() = 'educator'
           and room.id in (select public.my_classroom_ids())
         )
       )
  ) then
    raise exception 'Choose an accessible classroom from your center';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Each meal must be an object'; end if;
    v_type := nullif(btrim(v_item->>'meal_type'), '');
    v_label := nullif(btrim(v_item->>'meal_label'), '');
    v_food := nullif(btrim(v_item->>'food_description'), '');
    if v_type is null or v_type not in ('morning_snack', 'lunch', 'afternoon_snack') then
      raise exception 'Choose a valid meal type';
    end if;
    if v_type = any(v_types) then raise exception 'Each meal type can appear only once'; end if;
    v_types := array_append(v_types, v_type);
    if v_label is null or char_length(v_label) > 60 then
      raise exception 'Meal labels must be between 1 and 60 characters';
    end if;
    if v_food is null or char_length(v_food) > 250 then
      raise exception 'Meal descriptions must be between 1 and 250 characters';
    end if;
    if nullif(btrim(v_item->>'meal_time'), '') is null then
      raise exception 'Use a valid serving time for every meal';
    end if;
    begin
      perform (v_item->>'meal_time')::time;
    exception when others then
      raise exception 'Use a valid serving time for every meal';
    end;
    if jsonb_typeof(coalesce(v_item->'allergens', '[]'::jsonb)) <> 'array' then
      raise exception 'Allergens must be a list';
    end if;
    select array_agg(distinct lower(btrim(value)))
      into v_allergens
      from jsonb_array_elements_text(coalesce(v_item->'allergens', '[]'::jsonb)) source(value)
     where nullif(btrim(value), '') is not null;
    if coalesce(cardinality(v_allergens), 0) > 20
       or exists (select 1 from unnest(coalesce(v_allergens, array[]::text[])) value where char_length(value) > 50) then
      raise exception 'Use no more than 20 allergen labels of 50 characters each';
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(item) order by item.meal_time), '[]'::jsonb)
    into v_before
    from public.meal_menu_items item
   where item.daycare_id = v_daycare_id
     and item.menu_date = p_menu_date
     and item.classroom_id is not distinct from p_classroom_id;

  delete from public.meal_menu_items item
   where item.daycare_id = v_daycare_id
     and item.menu_date = p_menu_date
     and item.classroom_id is not distinct from p_classroom_id;

  insert into public.meal_menu_items (
    daycare_id, classroom_id, menu_date, meal_type, meal_label, meal_time,
    food_description, allergens, created_by
  )
  select v_daycare_id, p_classroom_id, p_menu_date,
    source.meal_type, btrim(source.meal_label), source.meal_time,
    btrim(source.food_description),
    coalesce((select array_agg(distinct lower(btrim(allergen)))
                from unnest(coalesce(source.allergens, array[]::text[])) allergen
               where nullif(btrim(allergen), '') is not null), array[]::text[]),
    auth.uid()
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as source(
    meal_type text, meal_label text, meal_time time,
    food_description text, allergens text[]
  );

  select coalesce(jsonb_agg(to_jsonb(item) order by item.meal_time), '[]'::jsonb)
    into v_after
    from public.meal_menu_items item
   where item.daycare_id = v_daycare_id
     and item.menu_date = p_menu_date
     and item.classroom_id is not distinct from p_classroom_id;

  insert into public.audit_log (
    daycare_id, actor_id, action, entity_type, before, after
  ) values (
    v_daycare_id, auth.uid(), 'save_day', 'meal_menu', v_before,
    jsonb_build_object(
      'menu_date', p_menu_date,
      'classroom_id', p_classroom_id,
      'items', v_after
    )
  );

  return query
    select item.* from public.meal_menu_items item
     where item.daycare_id = v_daycare_id
       and item.menu_date = p_menu_date
       and item.classroom_id is not distinct from p_classroom_id
     order by item.meal_time, item.meal_type;
end;
$$;

revoke all on function public.save_meal_menu_day(date, uuid, jsonb) from public, anon;
grant execute on function public.save_meal_menu_day(date, uuid, jsonb) to authenticated;

comment on function public.save_meal_menu_day(date, uuid, jsonb) is
  'Atomically validates and replaces one accessible room/day menu and records the change.';

create or replace function public.meal_allergy_overlap(
  p_child_allergies text[],
  p_menu_allergens text[]
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select exists (
    select 1
      from unnest(coalesce(p_child_allergies, array[]::text[])) child_allergy
      cross join unnest(coalesce(p_menu_allergens, array[]::text[])) menu_allergen
      cross join lateral regexp_split_to_table(lower(child_allergy), '[^a-z0-9]+') child_word
      cross join lateral regexp_split_to_table(lower(menu_allergen), '[^a-z0-9]+') menu_word
     where child_word <> '' and child_word = menu_word
  )
$$;

create or replace function public.enforce_meal_entry_allergy_alternative()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allergies text[];
  v_menu public.meal_menu_items%rowtype;
begin
  if new.meal_menu_item_id is null then return new; end if;
  select child.allergies into v_allergies
    from public.daily_logs daily_log
    join public.children child on child.id = daily_log.child_id
   where daily_log.id = new.daily_log_id;
  select * into v_menu from public.meal_menu_items where id = new.meal_menu_item_id;
  if v_menu.id is null then raise exception 'The selected menu item no longer exists'; end if;
  if public.meal_allergy_overlap(v_allergies, v_menu.allergens)
     and lower(btrim(new.food_type)) = lower(btrim(v_menu.food_description)) then
    raise exception 'Record the safe alternative served to the child with an allergy';
  end if;
  return new;
end;
$$;

drop trigger if exists meal_entry_allergy_alternative_guard on public.meal_entries;
create trigger meal_entry_allergy_alternative_guard
  before insert or update
  on public.meal_entries
  for each row execute function public.enforce_meal_entry_allergy_alternative();

create or replace function public.bulk_log_scheduled_meal(
  p_child_ids uuid[],
  p_menu_item_id uuid,
  p_amounts jsonb,
  p_alternatives jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_daycare uuid := public.get_my_daycare_id();
  v_today date := public.center_today();
  v_child_ids uuid[];
  v_selected integer;
  v_accessible integer;
  v_menu public.meal_menu_items%rowtype;
  v_alternative text;
begin
  if auth.uid() is null or not public.is_staff()
     or not public.has_permission('daily_logs', 'edit') then
    raise exception 'Daily log edit permission is required';
  end if;
  select array_agg(distinct requested.child_id)
    into v_child_ids
    from unnest(coalesce(p_child_ids, array[]::uuid[])) requested(child_id)
   where requested.child_id is not null;
  v_selected := coalesce(cardinality(v_child_ids), 0);
  if v_selected = 0 then raise exception 'Choose at least one child'; end if;
  if v_selected > 50 then raise exception 'Choose no more than 50 children at once'; end if;
  if jsonb_typeof(coalesce(p_amounts, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_alternatives, '{}'::jsonb)) <> 'object' then
    raise exception 'Meal amounts and alternatives must be keyed by child';
  end if;

  select * into v_menu
    from public.meal_menu_items menu
   where menu.id = p_menu_item_id
     and menu.daycare_id = v_daycare
     and menu.menu_date = v_today;
  if v_menu.id is null then raise exception 'This meal is no longer on today''s menu'; end if;

  select count(*)::integer into v_accessible
    from public.children child
   where child.id = any(v_child_ids)
     and child.daycare_id = v_daycare
     and child.archived_at is null
     and coalesce(child.enrolled_on, '-infinity'::date) <= v_today
     and public.can_access_child_area(child.id, 'daily_logs', 'edit')
     and (v_menu.classroom_id is null or v_menu.classroom_id = child.classroom_id);
  if v_accessible <> v_selected then
    raise exception 'This menu item is unavailable for one or more selected children';
  end if;
  if exists (
    select 1 from unnest(v_child_ids) selected(child_id)
     where coalesce(p_amounts->>selected.child_id::text, '') not in ('all', 'some', 'none')
  ) then raise exception 'Choose how much every selected child ate'; end if;

  for v_alternative in
    select nullif(btrim(p_alternatives->>child.id::text), '')
      from public.children child
     where child.id = any(v_child_ids)
       and public.meal_allergy_overlap(child.allergies, v_menu.allergens)
  loop
    if v_alternative is null then
      raise exception 'Record the safe alternative served to every child with an allergy';
    end if;
    if char_length(v_alternative) > 250 then raise exception 'A safe alternative is too long'; end if;
    if lower(v_alternative) = lower(btrim(v_menu.food_description)) then
      raise exception 'The safe alternative must differ from the planned allergen meal';
    end if;
  end loop;

  insert into public.daily_logs (daycare_id, child_id, educator_id, log_date)
  select v_daycare, child.id, auth.uid(), v_today
    from public.children child where child.id = any(v_child_ids)
  on conflict (child_id, log_date) do nothing;

  perform 1 from public.daily_logs daily_log
   where daily_log.child_id = any(v_child_ids) and daily_log.log_date = v_today
   for update;
  if exists (
    select 1 from public.daily_logs daily_log
     where daily_log.child_id = any(v_child_ids)
       and daily_log.log_date = v_today
       and coalesce(daily_log.sent_to_parents, false)
  ) then raise exception 'A selected child already has a final daily report'; end if;

  insert into public.meal_entries (
    daily_log_id, time, food_type, amount, meal_menu_item_id
  )
  select daily_log.id, v_menu.meal_time,
    coalesce(nullif(btrim(p_alternatives->>daily_log.child_id::text), ''), v_menu.food_description),
    p_amounts->>daily_log.child_id::text, v_menu.id
    from public.daily_logs daily_log
   where daily_log.child_id = any(v_child_ids) and daily_log.log_date = v_today
  on conflict (daily_log_id, meal_menu_item_id) do update set
    time = excluded.time,
    food_type = excluded.food_type,
    amount = excluded.amount;

  return jsonb_build_object(
    'selectedCount', v_selected,
    'affectedCount', v_selected,
    'mealMenuItemId', v_menu.id
  );
end;
$$;

revoke all on function public.bulk_log_scheduled_meal(uuid[], uuid, jsonb, jsonb) from public, anon;
grant execute on function public.bulk_log_scheduled_meal(uuid[], uuid, jsonb, jsonb) to authenticated;

comment on function public.bulk_log_scheduled_meal(uuid[], uuid, jsonb, jsonb) is
  'Atomically logs a scheduled menu item and requires per-child safe alternatives for allergen conflicts.';
