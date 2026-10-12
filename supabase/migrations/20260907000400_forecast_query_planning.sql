-- These small, correlated planning queries do not benefit from JIT compilation.
-- Disable it within the functions only, without changing project settings.
alter function public._room_demand_forecast(uuid,date,uuid) set jit=off;
alter function public._can_lend_educator(uuid,uuid,timestamptz,timestamptz) set jit=off;
alter function public.get_coverage_candidates(uuid,date,time,time) set jit=off;
alter function public.get_room_demand_forecast(date) set jit=off;
