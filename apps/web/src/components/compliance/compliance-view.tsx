"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  FileText,
  History,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  complianceReadiness,
  currentComplianceDocuments,
  staffFileGaps,
  type ComplianceDocument,
  type ComplianceInspectionPack,
  type ComplianceStaffFile,
} from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { UploadModal, DrillModal, DrillHistoryModal } from "./compliance-forms";
import {
  card,
  heading,
  link,
  date,
  days,
  time,
  documentTypes,
  drillTypes,
  ModalTitle,
} from "./shared";

export function ComplianceView({
  pack,
  documents,
  canEdit,
}: {
  pack: ComplianceInspectionPack;
  documents: ComplianceDocument[];
  canEdit: boolean;
}) {
  const [upload, setUpload] = useState<ComplianceDocument | "new" | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const [history, setHistory] = useState<ComplianceDocument | null>(null);
  const [staffFile, setStaffFile] = useState<ComplianceStaffFile | null>(null);
  const [drillHistory, setDrillHistory] = useState(false);
  const [notice, setNotice] = useState("");
  const current = currentComplianceDocuments(documents);
  const readiness = complianceReadiness(pack);
  const expiring = [
    ...current
      .filter(
        (d) =>
          d.watch_expiry &&
          d.expires_on &&
          days(d.expires_on, pack.today) <= 60,
      )
      .map((d) => ({
        id: d.id,
        item: d.title,
        who: "Center vault",
        expiry: d.expires_on!,
        href: `/compliance/documents/${d.id}`,
        action: "View document",
      })),
    ...pack.staff.flatMap((s) =>
      s.credentials
        .filter((c) => c.expires_on && days(c.expires_on, pack.today) <= 60)
        .map((c) => ({
          id: c.id,
          item: c.name,
          who: s.name,
          expiry: c.expires_on!,
          href: `/staff/${s.id}`,
          action: c.pending_review ? "Review renewal" : "Staff file",
        })),
    ),
  ].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const gaps = pack.staff.filter((s) => staffFileGaps(s, pack.today).length);
  const latestDrills = Object.keys(drillTypes)
    .map((kind) => pack.drills.find((d) => d.kind === kind && !d.voided_at))
    .filter((d) => !!d);
  const versions: ComplianceDocument[] = [];
  let version = history;
  while (version) {
    versions.push(version);
    version = documents.find((d) => d.id === version!.replaces_id) ?? null;
  }
  return (
    <>
      <SectionHeader
        title="Compliance"
        subtitle="Everything an inspector would ask for, in one place"
        showUtilities={false}
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!canEdit}
              onClick={() => setDrillOpen(true)}
            >
              Log a drill
            </Button>
            <Button disabled={!canEdit} onClick={() => setUpload("new")}>
              Upload document
            </Button>
          </>
        }
      />
      <main className="flex-1 p-5 lg:p-7">
        {notice && (
          <p
            role="status"
            className="mb-4 rounded-xl bg-success/10 p-3 text-sm text-success"
          >
            {notice}
          </p>
        )}
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(290px,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <section className={card}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className={heading}>
                  Expiring soon{" "}
                  <span className="ml-2 rounded-full bg-warning-bg px-2.5 py-1 text-xs text-warning-text">
                    {expiring.length}
                  </span>
                </h2>
                <span className="text-xs text-faint">
                  Next 60 days · expired items stay visible
                </span>
              </div>
              {expiring.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-[12px]">
                    <thead className="text-[10px] tracking-wider text-faint">
                      <tr>
                        {["ITEM", "WHO / WHERE", "EXPIRES", "LEFT", ""].map(
                          (h, i) => (
                            <th key={i} className="pb-3 font-bold">
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {expiring.map((row) => (
                        <tr
                          key={row.id}
                          className="border-t border-hairline/50"
                        >
                          <td className="py-3 pr-3 font-bold text-ink">
                            {row.item}
                          </td>
                          <td className="pr-3 text-muted">{row.who}</td>
                          <td className="pr-3 text-muted">
                            {date(row.expiry)}
                          </td>
                          <td className="pr-3">
                            <span
                              className={`whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold ${days(row.expiry, pack.today) < 0 ? "bg-danger-bg text-danger" : "bg-warning-bg text-warning-text"}`}
                            >
                              {days(row.expiry, pack.today) < 0
                                ? "Expired"
                                : `${days(row.expiry, pack.today)} days`}
                            </span>
                          </td>
                          <td>
                            <Link href={row.href} className={link}>
                              {row.action}
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  No watched documents or staff credentials expire in the next
                  60 days.
                </p>
              )}
            </section>
            <section className={card}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className={heading}>Document vault</h2>
                <span className="text-xs text-faint">
                  Current originals · previous versions retained
                </span>
              </div>
              {current.length ? (
                <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {current.map((d) => (
                    <article
                      key={d.id}
                      className="flex flex-col rounded-xl border border-hairline bg-canvas p-4"
                    >
                      <FileText size={27} className="mb-3 text-primary" />
                      <h3 className="text-[13px] font-bold text-ink">
                        {d.title}
                      </h3>
                      <p className="mt-1 text-[11.5px] text-muted">
                        {documentTypes[d.category]} · v{d.version}
                      </p>
                      <p className="mt-1 text-[11.5px] text-muted">
                        {d.expires_on
                          ? `Expires ${date(d.expires_on)}`
                          : "No expiry recorded"}
                      </p>
                      <p className="mt-1 text-[11px] text-faint">
                        {d.include_in_inspection
                          ? "Included in inspection pack"
                          : "Internal only"}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-3">
                        <a
                          href={`/compliance/documents/${d.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className={link}
                        >
                          View ↗
                        </a>
                        <button
                          disabled={!canEdit}
                          className={`${link} disabled:opacity-40`}
                          onClick={() => setUpload(d)}
                        >
                          Replace
                        </button>
                        <button className={link} onClick={() => setHistory(d)}>
                          History
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-hairline p-7 text-center">
                  <Upload className="mx-auto mb-2 text-faint" />
                  <p className="text-sm text-muted">
                    Add your center’s licenses, insurance and inspection
                    reports.
                  </p>
                  <button
                    className={`${link} mt-3`}
                    onClick={() => setUpload("new")}
                    disabled={!canEdit}
                  >
                    Upload the first document
                  </button>
                </div>
              )}
            </section>
            <section className={card}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className={heading}>Staff file checklist</h2>
                <span className="text-xs text-faint">
                  {readiness.completeStaff}/{pack.staff.length} complete
                </span>
              </div>
              <p className="mb-3 text-xs text-muted">
                Educator renewal uploads appear here for review. A completion
                date alone does not replace the original document.
              </p>
              {pack.staff.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setStaffFile(s)}
                  className="flex w-full items-center gap-3 border-t border-hairline/50 py-3 text-left hover:bg-canvas"
                >
                  <Avatar name={s.name} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-bold text-ink">
                      {s.name}
                    </span>
                    <span className="block text-xs text-muted">
                      {staffFileGaps(s, pack.today)[0] ??
                        "Required records on file"}
                    </span>
                  </span>
                  {staffFileGaps(s, pack.today).length ? (
                    <span className="text-xs font-bold text-warning-text">
                      Review
                    </span>
                  ) : (
                    <Check size={16} className="text-success" />
                  )}
                  <ChevronRight size={15} className="text-faint" />
                </button>
              ))}
            </section>
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            <section className={card}>
              <h2 className={`${heading} flex items-center gap-2`}>
                <ShieldCheck size={18} />
                Inspection readiness
              </h2>
              <div className="my-4 flex items-baseline gap-2">
                <strong className="text-[30px] text-primary">
                  {readiness.score}%
                </strong>
                <span className="text-xs text-muted">
                  record checks complete
                </span>
              </div>
              <div className="space-y-3">
                {readiness.checks.map((c) => (
                  <div key={c.label} className="flex gap-2 text-[12px]">
                    {c.ok ? (
                      <Check
                        size={15}
                        className="mt-0.5 shrink-0 text-success"
                      />
                    ) : (
                      <span className="mt-0.5 size-[15px] shrink-0 text-center text-warning-text">
                        —
                      </span>
                    )}
                    <span>
                      <span className="block text-ink">{c.label}</span>
                      <span className="text-faint">{c.detail}</span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-[11.5px] leading-relaxed text-muted">
                {pack.menu_days} days with menus in the last 30 days. Ratio
                coverage is now retained as immutable state-change intervals
                during center hours; history before activation on {pack.ratio_ledger.captured_since
                  ? date(pack.ratio_ledger.captured_since)
                  : "the recorded date"} is limited to recorded exceptions. This
                checklist is not a licensing determination.
              </p>
              <Link
                href="/compliance/inspection"
                className={`${link} mt-4 block`}
              >
                Generate the inspection pack →
              </Link>
            </section>
            <section className={card}>
              <h2 className={`${heading} mb-3`}>Drill log</h2>
              {latestDrills.length ? (
                latestDrills.map((d) => (
                  <div
                    key={d.id}
                    className="border-t border-hairline/50 py-3 first:border-0"
                  >
                    <div className="flex justify-between text-[13px]">
                      <strong className="text-ink">{drillTypes[d.kind]}</strong>
                      <span className="text-muted">
                        {Math.floor(d.duration_seconds / 60)}m{" "}
                        {d.duration_seconds % 60}s
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {time(d.conducted_at, pack.timezone)}
                    </p>
                    <p
                      className={`mt-1 text-xs ${d.next_due_on && d.next_due_on < pack.today ? "font-bold text-danger" : "text-faint"}`}
                    >
                      {d.next_due_on
                        ? `Next due ${date(d.next_due_on)}`
                        : "No next drill scheduled"}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">
                  No drills recorded in the last 12 months.
                </p>
              )}
              <button
                className={`${link} mt-3 inline-flex items-center gap-1.5`}
                onClick={() => setDrillHistory(true)}
              >
                <History size={14} />
                Full drill history →
              </button>
            </section>
            {gaps.length > 0 && (
              <section className={`${card} border-warning/40`}>
                <h2 className={heading}>
                  {gaps.length} staff files need attention
                </h2>
                <p className="mt-2 text-xs text-muted">
                  Open a checklist to review missing originals, expired
                  credentials and educator submissions.
                </p>
                <button
                  onClick={() => setStaffFile(gaps[0])}
                  className={`${link} mt-3`}
                >
                  Review the first file →
                </button>
              </section>
            )}
          </div>
        </div>
      </main>
      {upload && (
        <UploadModal
          existing={upload === "new" ? null : upload}
          onClose={() => setUpload(null)}
          onSaved={() => {
            setUpload(null);
            setNotice(
              "Document saved. Its original and all previous versions are retained.",
            );
          }}
        />
      )}
      {drillOpen && (
        <DrillModal
          pack={pack}
          onClose={() => setDrillOpen(false)}
          onSaved={() => {
            setDrillOpen(false);
            setNotice(
              "Drill recorded, including the attendance comparison and next due date.",
            );
          }}
        />
      )}
      {history && (
        <Modal onClose={() => setHistory(null)} width={560}>
          <ModalTitle
            title="Document history"
            onClose={() => setHistory(null)}
          />
          <p className="text-sm text-muted">
            {history.title} · previous versions remain private and are not
            included in inspector links.
          </p>
          {versions.map((d, i) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-4 border-t border-hairline py-3"
            >
              <span>
                <strong className="block text-sm text-ink">
                  Version {d.version}
                  {i === 0 ? " · current" : ""}
                </strong>
                <span className="text-xs text-muted">
                  {time(d.created_at, pack.timezone)} ·{" "}
                  {Math.ceil(d.size_bytes / 1024)} KB
                </span>
              </span>
              <a
                href={`/compliance/documents/${d.id}`}
                target="_blank"
                rel="noreferrer"
                className={link}
              >
                View original ↗
              </a>
            </div>
          ))}
        </Modal>
      )}
      {staffFile && (
        <Modal onClose={() => setStaffFile(null)} width={520}>
          <ModalTitle
            title={`${staffFile.name}’s file`}
            onClose={() => setStaffFile(null)}
          />
          <p className="text-sm text-muted">
            Required records, expiry and educator renewal review.
          </p>
          {staffFile.credentials.length ? (
            staffFile.credentials.map((c) => (
              <div key={c.id} className="border-t border-hairline py-3">
                <div className="flex justify-between gap-3">
                  <strong className="text-sm text-ink">{c.name}</strong>
                  <span
                    className={`text-xs ${c.pending_review || !c.completed_on || !c.document_id || (c.expires_on && c.expires_on < pack.today) ? "text-warning-text" : "text-success"}`}
                  >
                    {c.pending_review
                      ? "Awaiting review"
                      : !c.completed_on
                        ? "Incomplete"
                        : !c.document_id
                          ? "Original missing"
                          : c.expires_on && c.expires_on < pack.today
                            ? "Expired"
                            : "On file"}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {c.required ? "Required" : "Optional"}
                  {c.expires_on ? ` · expires ${date(c.expires_on)}` : ""}
                </p>
                {c.document_id && (
                  <a
                    className={`${link} mt-2 inline-block`}
                    href={`/documents/${c.document_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View certificate ↗
                  </a>
                )}
              </div>
            ))
          ) : (
            <p className="text-sm text-warning-text">
              No required checklist has been configured.
            </p>
          )}
          <Link
            href={`/staff/${staffFile.id}`}
            className="rounded-full bg-primary px-4 py-3 text-center text-sm font-bold text-white"
          >
            Open full profile & review uploads
          </Link>
        </Modal>
      )}
      {drillHistory && (
        <DrillHistoryModal
          pack={pack}
          canEdit={canEdit}
          onClose={() => setDrillHistory(false)}
        />
      )}
    </>
  );
}
