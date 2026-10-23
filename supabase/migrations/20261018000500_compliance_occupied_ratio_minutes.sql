-- An empty classroom is not evidence of child supervision. Keep all captured
-- intervals for audit, but report a separate occupied-room denominator for
-- the inspection pack's headline ratio metric.
create or replace function public._compliance_ratio_ledger(p_daycare uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  with bounds as (
    select coalesce(d.timezone,'UTC') zone,d.opens_at,d.closes_at,
      d.ratio_ledger_started_at,
      (now() at time zone coalesce(d.timezone,'UTC'))::date today
    from public.daycares d where d.id=p_daycare
  ), base as (
    select h.*,c.name room,least(coalesce(h.ends_at,now()),now()) effective_end
    from public.room_ratio_history h join public.classrooms c on c.id=h.classroom_id,bounds b
    where h.daycare_id=p_daycare and (h.ends_at is null or h.ends_at>=(b.today-90)::timestamp at time zone b.zone)
  ), rows as (
    select * from base order by starts_at desc limit 5000
  ), durations as (
    select h.present_count,h.staff_count,h.required_staff,h.source,
      extract(epoch from (h.effective_end-greatest(h.starts_at,
        (b.today-30)::timestamp at time zone b.zone)))/60 as minutes
    from base h,bounds b
    where h.source<>'legacy_event' and h.effective_end>greatest(h.starts_at,
      (b.today-30)::timestamp at time zone b.zone)
  ), totals as (
    select coalesce(floor(sum(minutes)),0)::int observed,
      coalesce(floor(sum(minutes) filter(where staff_count>=required_staff)),0)::int compliant,
      coalesce(floor(sum(minutes) filter(where present_count>0)),0)::int occupied,
      coalesce(floor(sum(minutes) filter(where present_count>0 and staff_count>=required_staff)),0)::int occupied_compliant
    from durations
  )
  select jsonb_build_object(
    'captured_since',b.ratio_ledger_started_at,
    'opens_at',to_char(b.opens_at,'HH24:MI'),'closes_at',to_char(b.closes_at,'HH24:MI'),
    'observed_minutes',t.observed,'compliant_minutes',t.compliant,
    'over_minutes',greatest(t.observed-t.compliant,0),
    'occupied_minutes',t.occupied,'occupied_compliant_minutes',t.occupied_compliant,
    'occupied_over_minutes',greatest(t.occupied-t.occupied_compliant,0),
    'intervals',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'room',r.room,
      'starts_at',r.starts_at,'ends_at',r.ends_at,'present_count',r.present_count,
      'staff_count',r.staff_count,'required_staff',r.required_staff,
      'max_children_per_staff',r.max_children_per_staff,'source',r.source) order by r.starts_at desc)
      from rows r),'[]'::jsonb)
  ) from bounds b cross join totals t;
$$;
revoke all on function public._compliance_ratio_ledger(uuid) from public,anon,authenticated;

notify pgrst,'reload schema';
