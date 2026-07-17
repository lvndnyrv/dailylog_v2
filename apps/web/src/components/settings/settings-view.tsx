"use client";

import type { Closure, Tables } from "@dailylog/db";
import Link from "next/link";
import { useActionState, useState } from "react";
import {
  addClosureAction,
  deleteClosureAction,
  updateCenterAction,
  type SettingsActionState,
} from "@/lib/settings/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";

export interface AuditEntry {
  id: string;
  action: string;
  entity_type: string;
  created_at: string | null;
  actor: { full_name: string } | null;
}

const AUDIT_LABELS: Record<string, string> = {
  attendance_records: "attendance record",
  invoices: "invoice",
  incident_reports: "incident report",
  profiles: "role / membership",
  children: "child record",
};

export function SettingsView({
  daycare,
  closures,
  audit = [],
}: {
  daycare: Tables<"daycares"> | null;
  closures: Closure[];
  audit?: AuditEntry[];
}) {
  const [modal, setModal] = useState<"none" | "center" | "closure">("none");

  const fmt = (date: string) =>
    new Date(`${date}T12:00`).toLocaleDateString("en-CA", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });

  return (
    <div className="grid flex-1 grid-cols-2 items-start gap-4 p-7">
      <div className="flex flex-col gap-4">
        {/* Center profile 11b */}
        <section className={card}>
          <div className="mb-3 flex items-center gap-2">
            <h2 className={cardTitle}>Center profile</h2>
            <span className="flex-1" />
            <button
              type="button"
              onClick={() => setModal("center")}
              className="text-[12.5px] font-bold text-primary hover:text-primary-hover"
            >
              Edit
            </button>
          </div>
          <dl className="flex flex-col gap-2">
            <Row label="Name">{daycare?.name ?? "—"}</Row>
            <Row label="Address">{daycare?.address ?? "—"}</Row>
            <Row label="Phone">{daycare?.phone ?? "—"}</Row>
          </dl>
          <p className="mt-2.5 text-[11.5px] text-faint">
            This is what families see on invoices and the inquiry form.
          </p>
        </section>

        {/* Ratio rules pointer */}
        <section className={card}>
          <h2 className={`${cardTitle} mb-2`}>Ratio rules</h2>
          <p className="text-[12.5px] leading-relaxed text-muted">
            Children-per-educator minimums live with the rooms —{" "}
            <Link href="/rooms" className="font-bold text-primary hover:text-primary-hover">
              edit them there →
            </Link>
          </p>
        </section>

        {/* Audit log 11d */}
        <section className={card}>
          <h2 className={`${cardTitle} mb-2`}>Audit log</h2>
          {audit.length === 0 ? (
            <p className="text-[12.5px] leading-relaxed text-faint">
              Sensitive changes land here automatically — attendance fixes,
              invoice changes, sign-offs, role and room moves.
            </p>
          ) : (
            <div className="flex flex-col">
              {audit.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-baseline gap-2 border-b border-[#EDF3FB] py-2 text-[12px] last:border-b-0"
                >
                  <span className="min-w-0 flex-1 truncate">
                    <b className="text-ink">{entry.actor?.full_name ?? "System"}</b>{" "}
                    <span className="text-muted">
                      {entry.action === "insert" ? "created a" : "changed a"}{" "}
                      {AUDIT_LABELS[entry.entity_type] ?? entry.entity_type}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-[10.5px] text-faint">
                    {entry.created_at
                      ? new Date(entry.created_at).toLocaleString("en-CA", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Closures 11c */}
      <section className={card}>
        <div className="mb-3 flex items-center gap-2">
          <h2 className={cardTitle}>Closures & holidays</h2>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setModal("closure")}
            className="rounded-btn bg-primary px-3.5 py-2 text-xs font-bold text-white hover:bg-primary-hover"
          >
            + Add closure
          </button>
        </div>
        {closures.length === 0 ? (
          <p className="text-[12.5px] text-faint">No closures planned.</p>
        ) : (
          <div className="flex flex-col">
            {closures.map((closure) => (
              <div
                key={closure.id}
                className="flex items-center gap-3 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-bold text-ink">{closure.reason}</span>
                  <span className="block text-[11.5px] text-muted">
                    {closure.starts_on === closure.ends_on
                      ? fmt(closure.starts_on)
                      : `${fmt(closure.starts_on)} – ${fmt(closure.ends_on)}`}
                  </span>
                </span>
                <form action={deleteClosureAction}>
                  <input type="hidden" name="closure_id" value={closure.id} />
                  <button
                    type="submit"
                    aria-label={`Remove ${closure.reason}`}
                    className="text-[11.5px] font-bold text-faint hover:text-danger"
                  >
                    ✕
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2.5 text-[11.5px] text-faint">
          Closures show in the family app calendar once notifications ship.
        </p>
      </section>

      {modal === "center" && daycare && (
        <CenterModal daycare={daycare} onClose={() => setModal("none")} />
      )}
      {modal === "closure" && <ClosureModal onClose={() => setModal("none")} />}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="text-right text-[12.5px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

function CenterModal({
  daycare,
  onClose,
}: {
  daycare: Tables<"daycares">;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    updateCenterAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={430}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Edit center profile</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          Shown to families on invoices and the inquiry form.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Center name" name="name" defaultValue={daycare.name} required />
        <Field label="Address" name="address" defaultValue={daycare.address ?? ""} />
        <Field label="Phone" name="phone" defaultValue={daycare.phone ?? ""} />
        {state.ok && (
          <Notice tone="success">
            <b>Saved.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ClosureModal({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState<SettingsActionState, FormData>(
    addClosureAction,
    {},
  );

  return (
    <Modal onClose={onClose} width={400}>
      <div>
        <h2 className="text-[19px] font-extrabold text-ink">Add a closure</h2>
        <p className="mt-0.5 text-[12.5px] leading-normal text-muted">
          One day or a range — leave the end empty for a single day.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Reason" name="reason" placeholder="Civic holiday" required />
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Starts" name="starts_on" type="date" required />
          <Field label="Ends (optional)" name="ends_on" type="date" />
        </div>
        {state.ok && (
          <Notice tone="success">
            <b>Added.</b>
          </Notice>
        )}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        <div className="flex gap-2.5">
          <Button type="button" variant="secondary" className="flex-1 py-3 text-sm" onClick={onClose}>
            {state.ok ? "Close" : "Cancel"}
          </Button>
          <Button type="submit" className="flex-1 py-3 text-sm" disabled={pending}>
            {pending ? "Adding…" : "Add closure"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
