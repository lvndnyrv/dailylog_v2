"use client";

import { useActionState, useState } from "react";
import {
  kioskCheckAction,
  kioskLookupAction,
  type KioskState,
} from "@/lib/attendance/actions";
import { BrandMark } from "@/components/brand";

// Kiosk 8b — big targets, one flow: code → family → tap a child.
export function KioskView() {
  const [lookupState, lookup] = useActionState<KioskState, FormData>(
    kioskLookupAction,
    {},
  );
  const [checkState, check, checking] = useActionState<KioskState, FormData>(
    kioskCheckAction,
    {},
  );
  const [pin, setPin] = useState("");

  const state = checkState.family ? checkState : lookupState;
  const family = state.family;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-7 bg-canvas p-8">
      <BrandMark />

      {!family ? (
        <>
          <div className="text-center">
            <h1 className="text-[28px] font-extrabold text-ink">Good morning!</h1>
            <p className="mt-1 text-[15px] text-muted">
              Tap in your family&apos;s 4-digit code
            </p>
          </div>

          <form action={lookup} className="flex flex-col items-center gap-6">
            <input type="hidden" name="pin" value={pin} />
            <div className="flex gap-3" aria-label="Code entry" role="status">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`grid h-16 w-14 place-items-center rounded-xl border-[1.5px] text-[26px] font-extrabold text-ink ${
                    pin.length === i
                      ? "border-[var(--primary)]"
                      : "border-[#D6E1F0] bg-card"
                  }`}
                >
                  {pin[i] ? "•" : ""}
                </span>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2.5">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "go"].map(
                (key) => (
                  <button
                    key={key}
                    type={key === "go" ? "submit" : "button"}
                    disabled={key === "go" && pin.length !== 4}
                    onClick={
                      key === "clear"
                        ? () => setPin("")
                        : key === "go"
                          ? undefined
                          : () => setPin((p) => (p.length < 4 ? p + key : p))
                    }
                    className={`h-16 w-20 rounded-btn text-[20px] font-extrabold ${
                      key === "go"
                        ? "bg-primary text-white disabled:opacity-40"
                        : key === "clear"
                          ? "bg-card text-[13px] font-bold text-muted"
                          : "border-[1.5px] border-[#D6E1F0] bg-card text-ink hover:bg-white"
                    }`}
                  >
                    {key === "go" ? "→" : key === "clear" ? "Clear" : key}
                  </button>
                ),
              )}
            </div>
            {state.error && (
              <p className="rounded-[13px] border-[1.5px] border-[#EFC9C9] bg-danger-bg px-4 py-2.5 text-[13px] font-semibold text-ink">
                {state.error}
              </p>
            )}
          </form>
        </>
      ) : (
        <>
          <div className="text-center">
            <h1 className="text-[24px] font-extrabold text-ink">
              Hi, {family[0]?.pickup_name?.split(" ")[0]}!
            </h1>
            <p className="mt-1 text-[14px] text-muted">Who&apos;s coming or going?</p>
          </div>

          {checkState.result && (
            <p className="rounded-[13px] border-[1.5px] border-[#BFE3D0] bg-[#E4F3EC] px-5 py-3 text-[15px] font-bold text-ink">
              ✓ {checkState.result.childName} {checkState.result.direction}
            </p>
          )}
          {checkState.error && (
            <p className="rounded-[13px] border-[1.5px] border-[#EFC9C9] bg-danger-bg px-4 py-2.5 text-[13px] font-semibold text-ink">
              {checkState.error}
            </p>
          )}

          <div className="flex w-full max-w-sm flex-col gap-3">
            {family.map((child) => {
              const isIn = child.checked_in_at && !child.checked_out_at;
              return (
                <form key={child.child_id} action={check}>
                  <input type="hidden" name="child_id" value={child.child_id} />
                  <input type="hidden" name="pin" value={state.pin ?? ""} />
                  <input
                    type="hidden"
                    name="child_name"
                    value={`${child.first_name} ${child.last_name}`}
                  />
                  <button
                    type="submit"
                    disabled={checking}
                    className={`flex w-full items-center gap-3 rounded-2xl border-[1.5px] p-4 text-left ${
                      isIn
                        ? "border-[#D6E1F0] bg-card"
                        : "border-[var(--primary)] bg-[#E7F0FB]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[16px] font-extrabold text-ink">
                        {child.first_name}
                        {child.room_name ? (
                          <span className="font-semibold text-faint"> · {child.room_name}</span>
                        ) : null}
                      </span>
                      <span className="block text-[12px] text-muted">
                        {isIn ? "in right now" : child.checked_out_at ? "checked out" : "not in yet"}
                      </span>
                    </span>
                    <span
                      className={`rounded-btn px-4 py-2.5 text-[14px] font-bold ${
                        isIn ? "bg-warning-bg text-warning-text" : "bg-primary text-white"
                      }`}
                    >
                      {isIn ? `Check out ${child.first_name}` : `Check in ${child.first_name}`}
                    </span>
                  </button>
                </form>
              );
            })}
          </div>

          <a href="/kiosk" className="text-[13px] font-bold text-primary hover:text-primary-hover">
            Done — next family
          </a>
        </>
      )}

      <p className="max-w-xs text-center text-[11.5px] leading-relaxed text-faint">
        The room list and live ratios update the second this is tapped. Ask at
        the desk if your code isn&apos;t working.
      </p>
    </main>
  );
}
