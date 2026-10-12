"use client";

import type { Tables } from "@dailylog/db";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { pauseRoomCombinationAction } from "@/lib/rooms/actions";

export function CombinationControls({ combinations, date }: { combinations: Tables<"room_combinations">[]; date: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return <div className="mt-3 flex flex-col gap-2">
    {combinations.filter(item => item.enabled && item.activated_at).map(item => {
      const paused = item.paused_on === date;
      return <div key={item.id} className="flex items-center gap-2 rounded-xl border border-hairline px-3 py-2 text-[11px]">
        <span className="flex-1 capitalize">{item.period} · {item.starts_at.slice(0,5)}–{item.ends_at.slice(0,5)}{paused ? " · paused today" : " · weekdays"}</span>
        <button disabled={pending} className="font-bold text-primary disabled:opacity-50" onClick={() => startTransition(async () => {
          setError(null);
          try {
            const result = await pauseRoomCombinationAction(item.id, !paused);
            if (result.error) setError(result.error); else router.refresh();
          } catch { setError("Could not change the schedule. Please try again."); }
        })}>{paused ? "Resume today" : "Pause today"}</button>
      </div>;
    })}
    {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
  </div>;
}

export function LiveRoomsRefresh() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => { if (!document.hidden) router.refresh(); };
    const timer = setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  return null;
}
