-- Preserve the menu provenance while allowing educators to record a changed
-- actual serving. Allergy-specific alternatives remain authoritative.

create or replace function public.bulk_log_scheduled_meal(
  p_child_ids uuid[],
  p_menu_item_id uuid,
  p_amounts jsonb,
  p_alternatives jsonb,
  p_food_type text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_food text := nullif(btrim(p_food_type), '');
  v_child_ids uuid[];
begin
  if v_food is null then raise exception 'Enter what was served before saving'; end if;
  if char_length(v_food) > 250 then raise exception 'Meal description is too long'; end if;

  v_result := public.bulk_log_scheduled_meal(
    p_child_ids, p_menu_item_id, p_amounts, p_alternatives
  );

  select array_agg(distinct requested.child_id)
    into v_child_ids
    from unnest(coalesce(p_child_ids, array[]::uuid[])) requested(child_id)
   where requested.child_id is not null;

  update public.meal_entries meal
     set food_type = v_food
    from public.daily_logs daily_log
    join public.children child on child.id = daily_log.child_id
    join public.meal_menu_items menu on menu.id = p_menu_item_id
   where meal.daily_log_id = daily_log.id
     and meal.meal_menu_item_id = menu.id
     and daily_log.child_id = any(v_child_ids)
     and daily_log.log_date = public.center_today()
     and not public.meal_allergy_overlap(child.allergies, menu.allergens);

  return v_result || jsonb_build_object('foodType', v_food);
end;
$$;

revoke all on function public.bulk_log_scheduled_meal(uuid[], uuid, jsonb, jsonb) from authenticated;
revoke all on function public.bulk_log_scheduled_meal(uuid[], uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.bulk_log_scheduled_meal(uuid[], uuid, jsonb, jsonb, text) to authenticated;

comment on function public.bulk_log_scheduled_meal(uuid[], uuid, jsonb, jsonb, text) is
  'Logs the scheduled menu provenance, actual shared serving, amounts, and allergy alternatives atomically.';
