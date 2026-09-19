"use client";

import { useEffect, useState } from "react";
import { previewRoomTransition } from "@/lib/rooms/actions";

type Result = Awaited<ReturnType<typeof previewRoomTransition>>;

export function TransitionCapacityPreview({ childId, roomId, from, onChoose }: {
  childId: string; roomId: string; from: string; onChoose: (date: string) => void;
}) {
  const [result, setResult] = useState<{ key: string; value: Result } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const key = `${childId}:${roomId}:${from}:${refresh}`;
  useEffect(() => {
    if (!roomId || !from) return;
    let ignore = false;
    previewRoomTransition(childId, roomId, from).then((value) => {
      if (!ignore) setResult({ key, value });
    }).catch(() => { if (!ignore) setResult({ key, value: { data: [], error: "Could not check capacity. Try refreshing." } }); });
    return () => { ignore = true; };
  }, [childId, roomId, from, key]);
  if (!roomId || !from) return null;
  const current = result?.key === key ? result.value : null;
  const selected = current?.data[0];
  const first = current?.data.find((day) => day.available);
  return <section aria-label="Move capacity estimate" aria-live="polite" className="rounded-[13px] border border-[#D6E1F0] bg-canvas p-3 text-[12px] text-muted">
    <div className="flex items-center justify-between gap-2"><b className="text-ink">Projected space</b><button type="button" className="font-bold text-primary" onClick={() => setRefresh((value) => value + 1)}>Refresh</button></div>
    {!current ? <p className="mt-2">Checking dated enrollment…</p> : current.error ? <p role="alert" className="mt-2 text-danger">{current.error}</p> : <>
      <p className="mt-2">{selected?.day}: {selected?.available ? "Space projected" : selected?.reason} · {selected?.projected_children} / {selected?.capacity ?? "?"} places before this move.</p>
      <p className="mt-1">Includes {selected?.offer_holds ?? 0} outstanding offer holds; {selected?.dependent_moves ?? 0} other planned moves affect this estimate.</p>
      {first ? <button type="button" className="mt-2 rounded-full bg-tint px-3 py-2 font-bold text-primary" onClick={() => onChoose(first.day)}>Use first projected opening · {first.day}</button> : <p className="mt-2 font-bold">No projected opening in this search window. Choose a later date or another room.</p>}
    </>}
    <p className="mt-2 text-[11px]">Searches up to 90 days ahead, within the next year. Counts enrollment places, not daily attendance: absences do not free a place. Dates depend on recorded starts, departures and moves being completed. This is not a reservation or staffing approval.</p>
  </section>;
}
