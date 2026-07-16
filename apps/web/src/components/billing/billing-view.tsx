"use client";

import type { BillingPlan, BillingSummary, InvoiceRow } from "@dailylog/db/queries";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { voidInvoiceAction } from "@/lib/billing/actions";
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
}

export function BillingView({
  summary,
  invoices,
  plans,
  childrenRows,
}: {
  summary: BillingSummary | null;
  invoices: InvoiceRow[];
  plans: BillingPlan[];
  childrenRows: ChildOption[];
}) {
  const [tab, setTab] = useState<Tab>("invoices");
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<
    "none" | "new" | "plan" | { invoice: InvoiceRow }
  >("none");

  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const isOverdue = (invoice: InvoiceRow) =>
    invoice.status === "open" && !!invoice.due_on && invoice.due_on < today;

  const visible = invoices.filter((invoice) => {
    if (filter === "overdue") return isOverdue(invoice);
    if (filter === "open") return invoice.status === "open" && !isOverdue(invoice);
    if (filter === "paid") return invoice.status === "paid";
    return true;
  });

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
            <div className={`grid grid-cols-[.9fr_1.4fr_1.2fr_.8fr_.8fr_1fr_90px] gap-2.5 border-b-[1.5px] border-[#EDF3FB] bg-[#F8FBFE] px-[18px] py-3 ${th}`}>
              <span>NUMBER</span>
              <span>FAMILY</span>
              <span>CHILD</span>
              <span>AMOUNT</span>
              <span>DUE</span>
              <span>STATUS</span>
              <span />
            </div>
            {visible.map((invoice) => {
              const overdue = isOverdue(invoice);
              const overdueDays = overdue
                ? Math.floor(
                    (Date.parse(`${today}T12:00`) - Date.parse(`${invoice.due_on}T12:00`)) /
                      86400000,
                  )
                : 0;
              return (
                <button
                  key={invoice.id}
                  type="button"
                  onClick={() => setModal({ invoice })}
                  className="grid w-full grid-cols-[.9fr_1.4fr_1.2fr_.8fr_.8fr_1fr_90px] items-center gap-2.5 border-b border-[#EDF3FB] px-[18px] py-3 text-left last:border-b-0 hover:bg-[#F8FBFE]"
                >
                  <span className="font-mono text-[12px] font-semibold text-ink">
                    {invoice.number}
                  </span>
                  <span className="flex items-center gap-2 truncate">
                    {invoice.billed_to_profile && (
                      <Avatar name={invoice.billed_to_profile.full_name} size={24} />
                    )}
                    <span className="truncate text-[12.5px] font-bold text-ink">
                      {invoice.billed_to_profile?.full_name ?? "—"}
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
                </button>
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
