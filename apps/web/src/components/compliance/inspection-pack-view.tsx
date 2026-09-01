"use client";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { Check, Printer, Link as LinkIcon } from "lucide-react";
import {
  complianceReadiness,
  staffFileGaps,
  type ComplianceInspectionPack,
  type ComplianceShare,
} from "@dailylog/db/queries";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import {
  createInspectionShare,
  revokeInspectionShare,
} from "@/lib/compliance/actions";
import {
  card,
  heading,
  input,
  label,
  link,
  date,
  time,
  drillTypes,
  ModalTitle,
  ErrorMessage,
} from "./shared";

export function InspectionPackView({
  pack,
  shares = [],
  shareToken,
  canEdit = false,
}: {
  pack: ComplianceInspectionPack;
  shares?: ComplianceShare[];
  shareToken?: string;
  canEdit?: boolean;
}) {
  const ready = complianceReadiness(pack);
  const observedRatioPercent = pack.ratio_ledger.observed_minutes
    ? Math.round(
        (pack.ratio_ledger.compliant_minutes /
          pack.ratio_ledger.observed_minutes) *
          100,
      )
    : null;
  const [shareOpen, setShareOpen] = useState(false);
  const docLink = (id: string, staff = false) =>
    shareToken
      ? `/inspection/${shareToken}/documents/${id}`
      : staff
        ? `/documents/${id}`
        : `/compliance/documents/${id}`;
  return (
    <main className="mx-auto w-full max-w-[1100px] space-y-5 p-5 text-ink lg:p-8 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {!shareToken && (
          <Link href="/compliance" className={link}>
            ← Compliance
          </Link>
        )}
        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => window.print()}>
            <span className="flex items-center gap-2">
              <Printer size={16} />
              Print the pack
            </span>
          </Button>
          {!shareToken && canEdit && (
            <Button onClick={() => setShareOpen(true)}>
              <span className="flex items-center gap-2">
                <LinkIcon size={16} />
                Create 48-hour link
              </span>
            </Button>
          )}
        </div>
      </div>
      <section className={card}>
        <div className="flex items-start gap-3">
          <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-warning-bg">
            <span className="size-4 rounded-full bg-warning" />
          </span>
          <div>
            <h1 className="text-xl font-extrabold">
              Inspection pack — {pack.center_name}
            </h1>
            <p className="mt-1 text-xs text-muted">
              Generated {time(pack.generated_at, pack.timezone)} ·{" "}
              {pack.timezone}
            </p>
            {pack.share_label && (
              <p className="mt-1 text-xs text-muted">
                {pack.share_label} · read-only · expires{" "}
                {time(pack.share_expires_at!, pack.timezone)}
              </p>
            )}
          </div>
        </div>
        <div className="my-5 grid grid-cols-3 gap-3">
          {[
            [`${ready.score}%`, "record checks complete"],
            [
              observedRatioPercent === null ? "—" : `${observedRatioPercent}%`,
              "observed ratio-compliant minutes · 30 days",
            ],
            [String(ready.unsigned), "unsigned incidents"],
          ].map(([v, t]) => (
            <div key={t} className="rounded-xl bg-canvas p-3">
              <strong className="block text-xl text-primary">{v}</strong>
              <span className="text-xs text-muted">{t}</span>
            </div>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            "Today’s sign-in sheets, per room",
            "Ratio coverage ledger and exception alerts",
            "Staff credential checklist and pending reviews",
            "Drill history, last 12 months",
            "Incident register and signature status, 12 months",
            "Current included licenses and insurance",
          ].map((t) => (
            <div key={t} className="flex items-center gap-2 text-xs">
              <Check size={14} className="text-success" />
              {t}
            </div>
          ))}
        </div>
        <p className="mt-4 border-t border-hairline pt-3 text-xs leading-relaxed text-muted">
          This is a live record summary, not a certification of regulatory
          readiness. Ratio history begins at the capture date shown below;
          earlier records contain only known exceptions.
          Staff originals and full incident narratives remain in their
          authorized workflows; the pack includes only the necessary register
          fields. Printed copies reflect the generation time.
        </p>
      </section>
      <PackSection
        title="Today’s sign-in sheets"
        note={`${date(pack.today)} · grouped by the child’s current room. Unrecorded attendance is not proof of absence.`}
      >
        <PackTable
          headers={[
            "Room / child",
            "In",
            "Out",
            "Recorded by family",
            "Status",
          ]}
          rows={pack.attendance.map((a) => [
            `${a.room ?? "Unassigned"} · ${a.child_name}`,
            time(a.checked_in_at, pack.timezone),
            time(a.checked_out_at, pack.timezone),
            `${a.dropped_off_by ?? "—"} / ${a.picked_up_by ?? "—"}`,
            a.status,
          ])}
          empty="No attendance entries recorded for today."
        />
      </PackSection>
      <PackSection
        title="Ratio coverage ledger"
        note={
          pack.ratio_ledger.captured_since
            ? `Ledger activated ${time(pack.ratio_ledger.captured_since, pack.timezone)} Continuous capture runs during configured center hours (${pack.ratio_ledger.opens_at}–${pack.ratio_ledger.closes_at}); planned closures and overnight hours are excluded. Pre-activation legacy rows are known exceptions only and are excluded from observed-minute totals.`
            : "Ratio coverage capture has not started yet. Historical exception records may still appear below."
        }
      >
        <div className="mb-4 grid grid-cols-3 gap-3">
          {[
            [String(pack.ratio_ledger.observed_minutes), "observed min · 30 days"],
            [String(pack.ratio_ledger.compliant_minutes), "compliant min"],
            [String(pack.ratio_ledger.over_minutes), "over-ratio min"],
          ].map(([value, caption]) => (
            <div key={caption} className="rounded-xl bg-canvas p-3">
              <strong className="block text-lg text-primary">{value}</strong>
              <span className="text-[11px] text-muted">{caption}</span>
            </div>
          ))}
        </div>
        <PackTable
          headers={["Room", "From", "To", "Children", "Staff / required", "Result"]}
          rows={pack.ratio_ledger.intervals.map((interval) => [
            interval.room,
            time(interval.starts_at, pack.timezone),
            interval.ends_at ? time(interval.ends_at, pack.timezone) : "Current",
            String(interval.present_count),
            `${interval.staff_count} / ${interval.required_staff}`,
            interval.staff_count >= interval.required_staff
              ? "In ratio"
              : interval.source === "legacy_event"
                ? "Over ratio · legacy event"
                : "Over ratio",
          ])}
          empty="No ratio intervals have been captured yet."
        />
        {pack.ratio_ledger.intervals.length >= 5000 && (
          <p className="mt-3 text-xs text-warning-text">
            This on-screen pack shows the latest 5,000 state changes. Use the
            ratio compliance report export for the full retained register.
          </p>
        )}
      </PackSection>
      <PackSection
        title="Ratio exception history"
        note="Last 90 days, plus unresolved exceptions. This alert register complements the coverage ledger above."
      >
        <PackTable
          headers={[
            "Room",
            "Started",
            "Resolved",
            "Peak children",
            "Minimum staff / required",
          ]}
          rows={pack.ratio_events.map((r) => [
            r.room,
            time(r.started_at, pack.timezone),
            r.resolved_at ? time(r.resolved_at, pack.timezone) : "Still open",
            String(r.peak_present),
            `${r.minimum_staff} / ${r.required_staff}`,
          ])}
          empty="No recorded ratio exceptions in this window."
        />
      </PackSection>
      <PackSection
        title="Staff files & certificates"
        note={`${ready.completeStaff}/${pack.staff.length} required checklists complete. Pending renewals are not treated as approved.`}
      >
        <div className="space-y-4">
          {pack.staff.map((s) => (
            <article
              key={s.id}
              className="break-inside-avoid border-t border-hairline pt-3 first:border-0 first:pt-0"
            >
              <div className="mb-2 flex justify-between gap-3">
                <h3 className="text-sm font-bold">{s.name}</h3>
                {!shareToken && (
                  <Link
                    href={`/staff/${s.id}`}
                    className={`${link} print:hidden`}
                  >
                    Open staff file
                  </Link>
                )}
              </div>
              {staffFileGaps(s, pack.today).length > 0 && (
                <p className="mb-2 text-xs text-warning-text">
                  {staffFileGaps(s, pack.today).join(" · ")}
                </p>
              )}
              <PackTable
                headers={[
                  "Item",
                  "Required",
                  "Completed",
                  "Expires",
                  "Original / review",
                ]}
                rows={s.credentials.map((c) => [
                  c.name,
                  c.required ? "Yes" : "No",
                  c.completed_on ? date(c.completed_on) : "Missing",
                  c.expires_on ? date(c.expires_on) : "Not recorded",
                  <span key={c.id}>
                    {c.pending_review ? "Renewal awaiting review · " : ""}
                    {c.document_id ? (
                      <span>
                        {shareToken ? (
                          "Original on file"
                        ) : (
                          <a
                            className={link}
                            href={docLink(c.document_id, true)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View original ↗
                          </a>
                        )}
                      </span>
                    ) : (
                      "Original missing"
                    )}
                  </span>,
                ])}
                empty="Required checklist not configured."
              />
            </article>
          ))}
        </div>
      </PackSection>
      <PackSection
        title="Drill history"
        note="Last 12 months. Voided entries remain visible for audit and are excluded from readiness checks."
      >
        {pack.drills.length ? (
          pack.drills.map((d) => (
            <article
              key={d.id}
              className="break-inside-avoid border-t border-hairline py-3 first:border-0"
            >
              <h3 className="text-sm font-bold">
                {drillTypes[d.kind]} · {time(d.conducted_at, pack.timezone)}
                {d.voided_at ? " · VOIDED" : ""}
              </h3>
              <p className="mt-1 text-xs text-muted">
                Led by {d.lead_name} · {Math.floor(d.duration_seconds / 60)}m{" "}
                {d.duration_seconds % 60}s · {d.children_count} children +{" "}
                {d.staff_count} staff accounted for
              </p>
              <p className="mt-1 text-xs text-muted">
                Recorded attendance comparison: {d.attendance_children} children
                + {d.attendance_staff} clocked-in staff
                {d.next_due_on ? ` · next due ${date(d.next_due_on)}` : ""}
              </p>
              {d.notes && (
                <p className="mt-2 whitespace-pre-wrap text-xs">{d.notes}</p>
              )}
              {d.void_reason && (
                <p className="mt-2 text-xs text-danger">
                  Void reason: {d.void_reason}
                </p>
              )}
            </article>
          ))
        ) : (
          <p className="text-sm text-muted">No drill records in this window.</p>
        )}
      </PackSection>
      <PackSection
        title="Incident register"
        note="Last 12 months · submitted reports only. Private medical narratives and photos are not included in shared packs."
      >
        <PackTable
          headers={[
            "Child",
            "Occurred",
            "Severity",
            "Admin sign-off",
            "Parent acknowledgment",
          ]}
          rows={pack.incidents.map((i) => [
            i.child_name,
            time(i.occurred_at, pack.timezone),
            i.severity,
            i.signed_off_at
              ? time(i.signed_off_at, pack.timezone)
              : "Awaiting sign-off",
            i.parent_acknowledged_at
              ? time(i.parent_acknowledged_at, pack.timezone)
              : "Not yet acknowledged",
          ])}
          empty="No submitted incidents in this window."
        />
      </PackSection>
      <PackSection
        title="Licenses, insurance & included documents"
        note="Only current versions selected for inspector sharing. Internal-only and superseded documents are excluded."
      >
        {pack.documents.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {pack.documents.map((d) => (
              <div
                key={d.id}
                className="break-inside-avoid rounded-xl border border-hairline p-3"
              >
                <strong className="block text-sm">
                  {d.title} · v{d.version}
                </strong>
                <p className="mt-1 text-xs text-muted">
                  {d.expires_on
                    ? `Expires ${date(d.expires_on)}`
                    : "No expiry recorded"}
                </p>
                <a
                  href={docLink(d.id)}
                  target="_blank"
                  rel="noreferrer"
                  className={`${link} mt-2 inline-block print:hidden`}
                >
                  View original ↗
                </a>
                <p className="hidden text-xs print:block">
                  Original available in the secure digital pack.
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">
            No documents selected for this pack.
          </p>
        )}
      </PackSection>
      {!shareToken && (
        <ShareHistory
          shares={shares}
          timezone={pack.timezone}
          generatedAt={pack.generated_at}
          canEdit={canEdit}
        />
      )}
      {shareOpen && (
        <ShareModal
          timezone={pack.timezone}
          onClose={() => setShareOpen(false)}
        />
      )}
      <style>{`@media print { @page { margin: 14mm; } thead { display: table-header-group; } tr { break-inside: avoid; } body { background: white !important; } a { text-decoration: none; } }`}</style>
    </main>
  );
}
function PackSection({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className={`${card} print:rounded-none print:border-0 print:px-0`}>
      <h2 className={`${heading} mb-1`}>{title}</h2>
      <p className="mb-4 text-xs leading-relaxed text-muted">{note}</p>
      {children}
    </section>
  );
}
function PackTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  return rows.length ? (
    <div className="overflow-x-auto print:overflow-visible">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                className="border-b border-hairline px-2 pb-2 font-bold text-muted first:pl-0"
                key={h}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td
                  key={j}
                  className="border-b border-hairline/50 px-2 py-2 align-top first:pl-0"
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="text-sm text-muted">{empty}</p>
  );
}
function ShareModal({
  timezone,
  onClose,
}: {
  timezone: string;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [expires, setExpires] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <Modal
      onClose={() => {
        if (!pending) onClose();
      }}
      width={540}
    >
      <ModalTitle
        title="Share an inspection pack"
        onClose={() => {
          if (!pending) onClose();
        }}
      />
      {url ? (
        <>
          <p className="text-sm text-muted">
            Read-only access expires {time(expires, timezone)}. You can revoke
            it from this page.
          </p>
          <label className={label}>
            Private inspection link
            <input
              className={input}
              value={url}
              readOnly
              onFocus={(e) => e.target.select()}
            />
          </label>
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
              } catch {
                setError("Copy the selected link manually.");
              }
            }}
          >
            {copied ? "Copied" : "Copy 48-hour link"}
          </Button>
        </>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            start(async () => {
              try {
                const r = await createInspectionShare(
                  String(form.get("label") ?? ""),
                );
                if (r.error) setError(r.error);
                else {
                  setUrl(`${window.location.origin}/inspection/${r.token}`);
                  setExpires(r.expiresAt!);
                }
              } catch {
                setError("Could not create the link. Please retry.");
              }
            });
          }}
        >
          <p className="rounded-xl bg-warning-bg p-3 text-sm leading-relaxed text-warning-text">
            Anyone with this link can see children’s attendance and
            incident-register information, staff credential status, drill notes
            and included vault originals. Send it only to the authorized
            inspector. It expires after 48 hours; openings are audited.
          </p>
          <label className={label}>
            Visit or recipient label (required)
            <input
              className={input}
              name="label"
              maxLength={120}
              required
              placeholder="e.g. September licensing visit"
              disabled={pending}
            />
          </label>
          <label className="flex items-start gap-2 text-xs leading-relaxed text-muted">
            <input
              className="mt-0.5 accent-primary"
              type="checkbox"
              required
              disabled={pending}
            />
            I’m authorized to share these records with the inspector. I
            understand the link follows current records until it expires or is
            revoked.
          </label>
          <Button disabled={pending}>
            {pending ? "Creating…" : "Create private link"}
          </Button>
        </form>
      )}
      <ErrorMessage error={error} />
    </Modal>
  );
}
function ShareHistory({
  shares,
  timezone,
  generatedAt,
  canEdit,
}: {
  shares: ComplianceShare[];
  timezone: string;
  generatedAt: string;
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  return (
    <section className={`${card} print:hidden`}>
      <h2 className={heading}>Inspection links</h2>
      <p className="mt-1 text-xs text-muted">
        Latest 50 links. Revoking stops future openings, but cannot recall
        copies already downloaded or printed.
      </p>
      <ErrorMessage error={error} />
      {shares.length ? (
        shares.map((s) => (
          <div
            key={s.id}
            className="mt-3 flex items-center justify-between gap-3 border-t border-hairline pt-3"
          >
            <span>
              <strong className="block text-sm">{s.label}</strong>
              <span className="text-xs text-muted">
                {s.revoked_at
                  ? "Revoked"
                  : Date.parse(s.expires_at) <= Date.parse(generatedAt)
                    ? "Expired"
                    : `Expires ${time(s.expires_at, timezone)}`}{" "}
                ·{" "}
                {s.last_opened_at
                  ? `last opened ${time(s.last_opened_at, timezone)}`
                  : "not opened"}
              </span>
            </span>
            {canEdit &&
              !s.revoked_at &&
              Date.parse(s.expires_at) > Date.parse(generatedAt) && (
                <button
                  disabled={pending}
                  className="text-xs font-bold text-danger"
                  onClick={() =>
                    start(async () => {
                      try {
                        const r = await revokeInspectionShare(s.id);
                        if (r.error) setError(r.error);
                      } catch {
                        setError("Unable to revoke the link. Please retry.");
                      }
                    })
                  }
                >
                  Revoke access
                </button>
              )}
          </div>
        ))
      ) : (
        <p className="mt-3 text-sm text-muted">
          No inspection links have been created.
        </p>
      )}
    </section>
  );
}
