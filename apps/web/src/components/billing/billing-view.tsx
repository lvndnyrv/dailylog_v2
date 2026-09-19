"use client";

import type { BillingPlan, BillingSummary, ChildTuitionRateRow, InvoiceRow } from "@dailylog/db/queries";
import { Download, Mail, MoreHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { Avatar } from "@/components/ui/avatar";
import { sendInvoiceRemindersAction, voidInvoiceAction } from "@/lib/billing/actions";
import { InvoiceModal } from "./invoice-modal";
import { NewInvoiceModal } from "./new-invoice-modal";
import { PlanModal } from "./plan-modal";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const tileLabel = "font-mono text-[10.5px] font-semibold tracking-[.08em] text-faint";
const th = "font-bold text-[10.5px] tracking-[.07em] text-faint";

export function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
}

type Filter = "all" | "overdue" | "open" | "paid";
type Tab = "invoices" | "plans";

export interface ChildOption {
  id: string;
  name: string;
  guardianId: string | null;
  guardianName: string | null;
  tuitionRate: { amountCents: number; roomName: string; effectiveFrom: string } | null;
}

export function BillingView({
  summary,
  invoices,
  plans,
  tuitionRates,
  childrenRows,
  openNew = false,
  openInvoiceId,
}: {
  summary: BillingSummary | null;
  invoices: InvoiceRow[];
  plans: BillingPlan[];
  tuitionRates: ChildTuitionRateRow[];
  childrenRows: ChildOption[];
  openNew?: boolean;
  openInvoiceId?: string;
}) {
  const [tab, setTab] = useState<Tab>("invoices");
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<
    "none" | "new" | "plan" | { invoice: InvoiceRow }
  >(() => {
    if (openNew) return "new";
    const invoice = invoices.find((row) => row.id === openInvoiceId);
    return invoice ? { invoice } : "none";
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [reminding, startReminder] = useTransition();
  const bulkRef = useRef<HTMLDivElement>(null);

  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const isOverdue = (invoice: InvoiceRow) =>
    invoice.status === "open" && !!invoice.due_on && invoice.due_on < today;

  const visible = invoices.filter((invoice) => {
    if (filter === "overdue") return isOverdue(invoice);
    if (filter === "open") return invoice.status === "open" && !isOverdue(invoice);
    if (filter === "paid") return invoice.status === "paid";
    return true;
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedIds(new Set());
        setLastSelectedIndex(null);
        setMoreOpen(false);
        setBulkMessage(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (bulkRef.current && !bulkRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [moreOpen]);

  const toggleInvoice = (id: string, index: number, shiftKey: boolean) => {
    setBulkMessage(null);
    setSelectedIds((current) => {
      const next = new Set(current);
      const shouldSelect = !next.has(id);
      if (shiftKey && lastSelectedIndex !== null) {
        const from = Math.min(lastSelectedIndex, index);
        const to = Math.max(lastSelectedIndex, index);
        visible.slice(from, to + 1).forEach((invoice) => {
          if (shouldSelect) next.add(invoice.id);
          else next.delete(invoice.id);
        });
      } else if (shouldSelect) next.add(id);
      else next.delete(id);
      return next;
    });
    setLastSelectedIndex(index);
  };

  const allVisibleSelected = visible.length > 0 && visible.every((invoice) => selectedIds.has(invoice.id));
  const clearSelection = () => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
    setMoreOpen(false);
    setBulkMessage(null);
  };

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-xs ${
      active
        ? "bg-primary font-bold text-white"
        : "border-[1.5px] border-[#D6E1F0] bg-card font-semibold text-body hover:bg-canvas"
    }`;

  const tabClass = (active: boolean) =>
    `border-b-[2.5px] pb-2 text-[13px] ${
      active
        ? "border-[var(--primary)] font-bold text-primary"
        : "border-transparent font-semibold text-faint hover:text-muted"
    }`;

  return (
    <div className="flex flex-1 flex-col gap-4 p-7">
      {/* Tiles */}
      <div className="grid grid-cols-4 gap-3">
        <div className={card}>
          <span className={tileLabel}>COLLECTED — THIS MONTH</span>
          <span className="mt-1 block text-[24px] font-extrabold text-ink">
            {dollars(Number(summary?.collected_month_cents ?? 0))}
          </span>
          <span className="text-[11.5px] text-muted">
            of {dollars(Number(summary?.expected_month_cents ?? 0))} invoiced
          </span>
        </div>
        <div className={card}>
          <span className={tileLabel}>OUTSTANDING</span>
          <span
            className={`mt-1 block text-[24px] font-extrabold ${
              Number(summary?.overdue_count ?? 0) > 0 ? "text-danger" : "text-ink"
            }`}
          >
            {dollars(Number(summary?.outstanding_cents ?? 0))}
          </span>
          <span className="text-[11.5px] text-muted">
            {Number(summary?.overdue_count ?? 0)} overdue ·{" "}
            {Number(summary?.open_count ?? 0)} open
          </span>
        </div>
        <div className={`${card} opacity-70`}>
          <span className={tileLabel}>AUTOPAY</span>
          <span className="mt-1 block text-[24px] font-extrabold text-faint">—</span>
          <span className="text-[11.5px] text-muted">arrives with Stripe</span>
        </div>
        <div className={`${card} opacity-70`}>
          <span className={tileLabel}>NEXT PAYOUT</span>
          <span className="mt-1 block text-[24px] font-extrabold text-faint">—</span>
          <span className="text-[11.5px] text-muted">arrives with Stripe</span>
        </div>
      </div>

      {/* Tabs + actions */}
      <div className="flex items-center gap-5 border-b-[1.5px] border-hairline">
        <button type="button" className={tabClass(tab === "invoices")} onClick={() => setTab("invoices")}>
          Invoices
        </button>
        <button type="button" className={tabClass(tab === "plans")} onClick={() => setTab("plans")}>
          Plans
        </button>
        <span className="flex-1" />
        {tab === "invoices" ? (
          <button
            type="button"
            onClick={() => setModal("new")}
            className="mb-2 rounded-btn bg-primary px-[18px] py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
          >
            + New invoice
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setModal("plan")}
            className="mb-2 rounded-btn bg-primary px-[18px] py-2 text-[13px] font-bold text-white hover:bg-primary-hover"
          >
            + New plan
          </button>
        )}
      </div>

      {tab === "invoices" && (
        <>
          <div className="flex items-center gap-2">
            <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
              All · {invoices.length}
            </button>
            <button type="button" className={chip(filter === "overdue")} onClick={() => setFilter("overdue")}>
              Overdue · {invoices.filter(isOverdue).length}
            </button>
            <button type="button" className={chip(filter === "open")} onClick={() => setFilter("open")}>
              Open
            </button>
            <button type="button" className={chip(filter === "paid")} onClick={() => setFilter("paid")}>
              Paid
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
            <div className={`grid grid-cols-[34px_.9fr_1.4fr_1.2fr_.8fr_.8fr_1fr_90px] items-center gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${th}`}>
              <input
                type="checkbox"
                aria-label="Select all visible invoices"
                checked={allVisibleSelected}
                onChange={() => {
                  setBulkMessage(null);
                  setSelectedIds((current) => {
                    const next = new Set(current);
                    if (allVisibleSelected) visible.forEach((invoice) => next.delete(invoice.id));
                    else visible.forEach((invoice) => next.add(invoice.id));
                    return next;
                  });
                }}
                className="size-[17px] rounded-[5px] border-[#C3D2E6] accent-[var(--primary)]"
              />
              <span>NUMBER</span>
              <span>FAMILY</span>
              <span>CHILD</span>
              <span>AMOUNT</span>
              <span>DUE</span>
              <span>STATUS</span>
              <span />
            </div>
            {visible.map((invoice, index) => {
              const overdue = isOverdue(invoice);
              const overdueDays = overdue
                ? Math.floor(
                    (Date.parse(`${today}T12:00`) - Date.parse(`${invoice.due_on}T12:00`)) /
                      86400000,
                  )
                : 0;
              return (
                <div
                  key={invoice.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setModal({ invoice })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") setModal({ invoice });
                  }}
                  className={`grid w-full cursor-pointer grid-cols-[34px_.9fr_1.4fr_1.2fr_.8fr_.8fr_1fr_90px] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 text-left last:border-b-0 hover:bg-[#F8FBFE] focus-visible:bg-[#F8FBFE] focus-visible:outline-none ${
                    selectedIds.has(invoice.id) ? "bg-[#F5F9FE]" : ""
                  }`}
                >
                  <input
                    type="checkbox"
                    aria-label={`Select invoice ${invoice.number ?? invoice.id}`}
                    checked={selectedIds.has(invoice.id)}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      toggleInvoice(invoice.id, index, event.nativeEvent instanceof MouseEvent && event.nativeEvent.shiftKey)
                    }
                    className="size-[17px] rounded-[5px] border-[#C3D2E6] accent-[var(--primary)]"
                  />
                  <span className="font-mono text-[12px] font-semibold text-ink">
                    {invoice.number}
                  </span>
                  <span className="flex items-center gap-2 truncate">
                    {(invoice.family || invoice.billed_to_profile) && (
                      <Avatar
                        name={invoice.family?.display_name ?? invoice.billed_to_profile!.full_name}
                        size={24}
                      />
                    )}
                    <span className="truncate text-[12.5px] font-bold text-ink">
                      {invoice.family?.display_name ?? invoice.billed_to_profile?.full_name ?? "—"}
                    </span>
                  </span>
                  <span className="truncate text-[12.5px] text-muted">
                    {invoice.child ? `${invoice.child.first_name} ${invoice.child.last_name}` : "—"}
                  </span>
                  <span className="text-[12.5px] font-bold text-ink">
                    {dollars(invoice.total_cents)}
                  </span>
                  <span className="text-[12.5px] text-muted">
                    {invoice.due_on
                      ? new Date(`${invoice.due_on}T12:00`).toLocaleDateString("en-CA", {
                          month: "short",
                          day: "numeric",
                        })
                      : "—"}
                  </span>
                  <span>
                    {overdue ? (
                      <span className="whitespace-nowrap rounded-full bg-danger-bg px-2.5 py-[3px] text-[11px] font-bold text-danger">
                        Overdue · {overdueDays}d
                      </span>
                    ) : invoice.status === "paid" ? (
                      <span className="rounded-full bg-[#E4F3EC] px-2.5 py-[3px] text-[11px] font-bold text-success">
                        Paid
                      </span>
                    ) : invoice.status === "void" ? (
                      <span className="rounded-full bg-canvas px-2.5 py-[3px] text-[11px] font-bold text-faint">
                        Void
                      </span>
                    ) : (
                      <span className="rounded-full bg-[#E7F0FB] px-2.5 py-[3px] text-[11px] font-bold text-primary">
                        Open
                      </span>
                    )}
                  </span>
                  <span className="text-right text-[12px] font-bold text-primary">
                    {invoice.status === "open" ? "Record →" : "View →"}
                  </span>
                </div>
              );
            })}
            {visible.length === 0 && (
              <p className="px-5 py-8 text-center text-[12.5px] text-faint">
                No invoices here.
              </p>
            )}
          </div>
        </>
      )}

      {tab === "plans" && (
        <div className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
          <div className={`grid grid-cols-[2fr_1fr_1fr] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${th}`}>
            <span>PLAN</span>
            <span>AMOUNT</span>
            <span>CADENCE</span>
          </div>
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="grid grid-cols-[2fr_1fr_1fr] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0"
            >
              <span className="text-[13px] font-bold text-ink">{plan.name}</span>
              <span className="text-[12.5px] font-bold text-ink">{dollars(plan.amount_cents)}</span>
              <span className="text-[12.5px] capitalize text-muted">{plan.cadence}</span>
            </div>
          ))}
          {plans.length === 0 && (
            <p className="px-5 py-8 text-center text-[12.5px] text-faint">
              No plans yet — add your tuition rates.
            </p>
          )}
        </div>
        <div className="overflow-hidden rounded-2xl border-[1.5px] border-[#D6E1F0] bg-card">
          <div className="border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3">
            <h3 className="text-[13px] font-extrabold text-ink">Child rate changes</h3>
            <p className="mt-0.5 text-[11px] text-muted">Room-move rates are scheduled with the plan and become effective only when the move is completed. Existing invoices never change.</p>
          </div>
          <div className={`grid grid-cols-[1.4fr_1fr_1fr_.8fr] gap-2.5 border-b border-[#EDF3FB] px-[18px] py-2.5 ${th}`}>
            <span>CHILD</span><span>ROOM</span><span>EFFECTIVE</span><span>RATE</span>
          </div>
          {tuitionRates.map((rate) => (
            <div key={rate.id} className="grid grid-cols-[1.4fr_1fr_1fr_.8fr] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 last:border-b-0">
              <span className="text-[12.5px] font-bold text-ink">{rate.child ? `${rate.child.first_name} ${rate.child.last_name}` : "Child"}</span>
              <span className="truncate text-[12px] text-muted">{rate.classroom?.name ?? "—"}</span>
              <span className="text-[12px] text-muted">{rate.status === "scheduled" ? `Scheduled · ${rate.effective_from}` : rate.effective_to ? `Ended · ${rate.effective_to}` : `Effective · ${rate.effective_from}`}</span>
              <span className="text-[12.5px] font-bold text-ink">{dollars(rate.amount_cents)}</span>
            </div>
          ))}
          {tuitionRates.length === 0 && <p className="px-5 py-6 text-center text-[12px] text-faint">No child-specific rate changes yet.</p>}
        </div>
        </div>
      )}

      {selectedIds.size > 0 && tab === "invoices" && (
        <div
          ref={bulkRef}
          className="sticky bottom-4 z-30 mt-auto flex items-center gap-3 rounded-[14px] bg-ink px-4 py-3 text-white"
          style={{ boxShadow: "0 14px 36px rgba(23,51,91,.28)" }}
          role="toolbar"
          aria-label="Bulk invoice actions"
        >
          <span className="rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-bold">
            {selectedIds.size} selected
          </span>
          {bulkMessage && (
            <span className={`text-[11.5px] ${bulkMessage.tone === "error" ? "text-[#FFD0D0]" : "text-[#C9F1DB]"}`}>
              {bulkMessage.text}
            </span>
          )}
          <span className="flex-1" />
          <button
            type="button"
            disabled={reminding}
            onClick={() =>
              startReminder(async () => {
                const result = await sendInvoiceRemindersAction([...selectedIds]);
                setBulkMessage(
                  result.ok
                    ? { tone: "success", text: `${result.queued} reminder${result.queued === 1 ? "" : "s"} queued` }
                    : { tone: "error", text: result.error ?? "Could not queue reminders" },
                );
              })
            }
            className="flex items-center gap-1.5 text-[12.5px] font-bold hover:opacity-80 disabled:opacity-60"
          >
            <Mail size={14} strokeWidth={1.8} aria-hidden />
            {reminding ? "Queuing…" : "Remind"}
          </button>
          <span className="h-[18px] w-px bg-white/20" />
          <a
            href={`/reports-export/invoices?ids=${encodeURIComponent([...selectedIds].join(","))}`}
            download
            className="flex items-center gap-1.5 text-[12.5px] font-bold hover:opacity-80"
          >
            <Download size={14} strokeWidth={1.8} aria-hidden /> Export
          </a>
          <span className="h-[18px] w-px bg-white/20" />
          <div className="relative">
            <button type="button" onClick={() => setMoreOpen((current) => !current)} className="flex items-center gap-1.5 text-[12.5px] font-bold hover:opacity-80" aria-expanded={moreOpen} aria-haspopup="menu">
              <MoreHorizontal size={14} strokeWidth={1.8} aria-hidden /> More
            </button>
            {moreOpen && (
              <div role="menu" className="absolute bottom-9 right-0 flex w-44 flex-col rounded-xl border border-hairline bg-card p-1.5 text-ink" style={{ boxShadow: "0 12px 32px rgba(23,51,91,.22)" }}>
                <button type="button" role="menuitem" onClick={() => setModal({ invoice: invoices.find((invoice) => selectedIds.has(invoice.id))! })} className="rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold hover:bg-canvas">
                  Open first selected
                </button>
                <button type="button" role="menuitem" onClick={clearSelection} className="rounded-lg px-2.5 py-2 text-left text-[12.5px] font-semibold hover:bg-canvas">
                  Clear selection
                </button>
              </div>
            )}
          </div>
          <span className="h-[18px] w-px bg-white/20" />
          <button type="button" onClick={clearSelection} aria-label="Clear invoice selection" className="grid size-6 place-items-center rounded-md hover:bg-white/15">
            <X size={15} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      )}

      {modal === "new" && (
        <NewInvoiceModal
          childrenRows={childrenRows}
          plans={plans}
          onClose={() => setModal("none")}
        />
      )}
      {modal === "plan" && <PlanModal onClose={() => setModal("none")} />}
      {typeof modal === "object" && (
        <InvoiceModal
          invoice={modal.invoice}
          overdue={isOverdue(modal.invoice)}
          onVoid={voidInvoiceAction}
          onClose={() => setModal("none")}
        />
      )}
    </div>
  );
}
