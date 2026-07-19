"use client";

import type { DaycareLocationRow } from "@dailylog/db/queries";
import { Building2, Check, ChevronDown, Grid2X2, Plus } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import {
  createLocationAction,
  switchLocationAction,
  type LocationActionState,
} from "@/lib/location/actions";

export function LocationSwitcher({ locations }: { locations: DaycareLocationRow[] }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = locations.find((location) => location.is_active) ?? locations[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (locations.length < 2 || !active) return null;

  return (
    <>
      <div ref={ref} className="relative mb-2">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={`w-full rounded-xl border-[1.5px] px-3 py-2.5 text-left ${
            open ? "border-[#BFD6F2] bg-[#F4F8FD]" : "border-[#D6E1F0] bg-card hover:bg-canvas"
          }`}
        >
          <span className="block text-[9.5px] font-semibold tracking-[.08em] text-faint">LOCATION</span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: active.color }} />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-ink">
              {active.location_label}
            </span>
            <ChevronDown size={13} strokeWidth={1.9} className="text-muted" aria-hidden />
          </span>
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Switch location"
            className="absolute bottom-[70px] left-0 z-50 flex w-[274px] flex-col gap-px rounded-[14px] border-[1.5px] border-hairline bg-card p-[7px]"
            style={{ boxShadow: "0 16px 44px rgba(23,51,91,.22)" }}
          >
            <span aria-hidden className="absolute -bottom-2 left-7 size-3.5 rotate-45 border-b-[1.5px] border-r-[1.5px] border-hairline bg-card" />
            <span className="px-2.5 pb-1 pt-1.5 font-mono text-[9.5px] font-bold tracking-[.08em] text-faint">
              SWITCH LOCATION
            </span>
            {locations.map((location) => (
              <form key={location.id} action={switchLocationAction}>
                <input type="hidden" name="daycare_id" value={location.id} />
                <button
                  type="submit"
                  role="menuitem"
                  disabled={location.is_active}
                  className={`flex w-full items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left ${
                    location.is_active ? "bg-canvas" : "hover:bg-canvas"
                  }`}
                >
                  <span className="grid size-[26px] flex-none place-items-center rounded-lg bg-[#EDF2F9]">
                    <span className="size-[11px] rounded-full" style={{ backgroundColor: location.color }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-bold text-ink">{location.location_label}</span>
                    <span className="block text-[10.5px] text-faint">{location.checked_in_count} in today</span>
                  </span>
                  {location.is_active && <Check size={14} strokeWidth={2} className="text-success" aria-hidden />}
                </button>
              </form>
            ))}
            <span className="mx-1 my-1 h-px bg-[#EDF3FB]" />
            <Link href="/locations" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[12.5px] font-semibold text-ink hover:bg-canvas">
              <Grid2X2 size={14} strokeWidth={1.7} aria-hidden /> All locations
            </Link>
            <button type="button" role="menuitem" onClick={() => { setOpen(false); setAdding(true); }} className="flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-left text-[12.5px] font-bold text-primary hover:bg-canvas">
              <Plus size={14} strokeWidth={1.9} aria-hidden /> Add a location
            </button>
          </div>
        )}
      </div>
      {adding && <AddLocationModal onClose={() => setAdding(false)} />}
    </>
  );
}

function AddLocationModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<LocationActionState, FormData>(
    createLocationAction,
    {},
  );
  const [color, setColor] = useState("#2F7CD8");
  const colors = ["#2F7CD8", "#7A5FD0", "#1F8A5B", "#F0B441"];

  return (
    <Modal onClose={onClose} width={430}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-xl bg-[#E3EDFA] text-primary"><Building2 size={18} aria-hidden /></span>
        <span className="min-w-0 flex-1">
          <h2 className="text-[19px] font-extrabold text-ink">Add a location</h2>
          <p className="mt-0.5 text-[12.5px] leading-normal text-muted">It gets its own rooms, children, staff, billing and attendance scope.</p>
        </span>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-ink">Location name<input name="location_label" required placeholder="e.g. Riverside" className="rounded-[12px] border-[1.5px] border-[#D6E1F0] px-3.5 py-3 text-[13px] font-normal outline-none focus:border-primary" /></label>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold text-ink">Address <span className="font-normal text-faint">optional</span><input name="address" placeholder="Street, city, postal code" className="rounded-[12px] border-[1.5px] border-[#D6E1F0] px-3.5 py-3 text-[13px] font-normal outline-none focus:border-primary" /></label>
        <fieldset><legend className="mb-2 text-[13px] font-bold text-ink">Location colour</legend><input type="hidden" name="color" value={color} /><div className="flex gap-2">{colors.map((option) => <button key={option} type="button" aria-label={`Use ${option}`} aria-pressed={color === option} onClick={() => setColor(option)} className={`grid size-9 place-items-center rounded-full border-2 ${color === option ? "border-ink" : "border-transparent"}`}><span className="size-6 rounded-full" style={{ backgroundColor: option }} /></button>)}</div></fieldset>
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex justify-end gap-2.5"><button type="button" onClick={onClose} className="rounded-btn border-[1.5px] border-[#D6E1F0] px-5 py-3 text-sm font-bold text-ink hover:bg-canvas">Cancel</button><button type="submit" disabled={pending} className="rounded-btn bg-primary px-5 py-3 text-sm font-bold text-white hover:bg-primary-hover disabled:opacity-60">{pending ? "Adding…" : "Add location"}</button></div>
      </form>
    </Modal>
  );
}
