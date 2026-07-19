import { listMyDaycareLocations } from "@dailylog/db/queries";
import { Check, MapPin } from "lucide-react";
import { SectionHeader } from "@/components/shell/header";
import { switchLocationAction } from "@/lib/location/actions";
import { getServerSupabase } from "@/lib/supabase/server";

export default async function LocationsPage() {
  const supabase = await getServerSupabase();
  const locations = await listMyDaycareLocations(supabase);

  return (
    <>
      <SectionHeader title="All locations" subtitle={`${locations.length} locations · choose one to scope the console`} />
      <main className="grid grid-cols-3 gap-4 p-7">
        {locations.map((location) => (
          <section key={location.id} className={`rounded-2xl border-[1.5px] bg-card p-5 ${location.is_active ? "border-[#BFD6F2]" : "border-hairline"}`}>
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-xl bg-canvas"><MapPin size={18} style={{ color: location.color }} aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-extrabold text-ink">{location.location_label}</span><span className="block truncate text-[11.5px] text-faint">{location.address ?? "Address not added"}</span></span>
              {location.is_active && <span className="flex items-center gap-1 rounded-full bg-[#E4F3EC] px-2.5 py-1 text-[11px] font-bold text-success"><Check size={12} /> Active</span>}
            </div>
            <div className="my-4 rounded-xl bg-canvas p-3"><span className="block text-[24px] font-extrabold text-ink">{location.checked_in_count}</span><span className="text-[11.5px] text-muted">children checked in now</span></div>
            {!location.is_active && <form action={switchLocationAction}><input type="hidden" name="daycare_id" value={location.id} /><button type="submit" className="w-full rounded-btn bg-primary px-4 py-2.5 text-[13px] font-bold text-white hover:bg-primary-hover">Open this location</button></form>}
          </section>
        ))}
      </main>
    </>
  );
}
