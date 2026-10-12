-- ============================================================================
-- Educator mobile Group 11 — realistic meal-menu demo data
-- Safe to run repeatedly. It seeds the demo center for today and last week.
-- ============================================================================

with demo as (
  select
    d.id as daycare_id,
    (
      select p.id
      from profiles p
      where p.daycare_id = d.id
        and p.role in ('owner_admin', 'admin')
      order by case p.role when 'owner_admin' then 0 else 1 end, p.created_at
      limit 1
    ) as created_by
  from daycares d
  where d.name ilike 'Sunny Grove%'
  order by d.created_at
  limit 1
),
items(menu_date, meal_type, meal_label, meal_time, food_description, allergens) as (
  values
    (
      current_date,
      'morning_snack',
      'Morning snack',
      time '09:30',
      'Apple slices, whole-grain crackers & cheese cubes',
      array['gluten', 'dairy']::text[]
    ),
    (
      current_date,
      'lunch',
      'Lunch',
      time '11:45',
      'Pasta with tomato sauce, cucumber salad, milk',
      array['gluten', 'dairy']::text[]
    ),
    (
      current_date - 7,
      'morning_snack',
      'Morning snack',
      time '09:30',
      'Banana rounds, oat cereal & yogurt',
      array['dairy']::text[]
    ),
    (
      current_date - 7,
      'lunch',
      'Lunch',
      time '11:45',
      'Chicken and vegetable rice bowls with milk',
      array['dairy']::text[]
    ),
    (
      current_date - 7,
      'afternoon_snack',
      'Afternoon snack',
      time '15:00',
      'Hummus, cucumber sticks & pita triangles',
      array['sesame', 'gluten']::text[]
    )
)
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
  demo.daycare_id,
  null,
  items.menu_date,
  items.meal_type,
  items.meal_label,
  items.meal_time,
  items.food_description,
  items.allergens,
  demo.created_by
from demo
cross join items
where demo.created_by is not null
  and not exists (
    select 1
    from meal_menu_items existing
    where existing.daycare_id = demo.daycare_id
      and existing.classroom_id is null
      and existing.menu_date = items.menu_date
      and existing.meal_type = items.meal_type
  );
