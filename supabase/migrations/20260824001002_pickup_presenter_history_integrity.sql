-- Pickup passes and plans are handoff records. A child_pickups row must be
-- archived, not hard-deleted; SET NULL conflicts with the pass invariant that
-- exactly one presenter is always retained.

alter table public.pickup_passes
  drop constraint if exists pickup_passes_pickup_id_fkey;
alter table public.pickup_passes
  add constraint pickup_passes_pickup_id_fkey
  foreign key (pickup_id) references public.child_pickups(id) on delete restrict;

alter table public.pickup_plans
  drop constraint if exists pickup_plans_pickup_id_fkey;
alter table public.pickup_plans
  add constraint pickup_plans_pickup_id_fkey
  foreign key (pickup_id) references public.child_pickups(id) on delete restrict;
