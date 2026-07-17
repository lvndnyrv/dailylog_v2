import { listRecentIncidents, listStaff } from "@dailylog/db/queries";
import { SectionHeader } from "@/components/shell/header";
import { Avatar } from "@/components/ui/avatar";
import { getServerSupabase } from "@/lib/supabase/server";

const card = "rounded-2xl border border-[rgba(23,51,91,.1)] bg-card p-[18px]";
const cardTitle = "text-[14px] font-extrabold text-ink";
const th = "font-bold text-[10.5px] tracking-[.07em] text-faint";

function expiryWindow(): { today: string; soon: string } {
  return {
    today: new Date().toISOString().slice(0, 10),
    soon: new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10),
  };
}

// Compliance 12a — the registers an inspector asks for: staff certifications
// with expiry status, and the signed incident log. The document vault (12d)
// arrives with storage wiring.
export default async function CompliancePage() {
  const supabase = await getServerSupabase();
  const [staff, incidents] = await Promise.all([
    listStaff(supabase),
    listRecentIncidents(supabase, 20),
  ]);

  const certRows = staff.flatMap((member) =>
    (member.certifications ?? []).map((cert) => ({
      staffName: member.profile!.full_name,
      ...cert,
    })),
  );
  const { today, soon } = expiryWindow();
  const expiring = certRows.filter((c) => c.expires_on && c.expires_on <= soon).length;

  const signed = incidents.filter((i) => i.status !== "submitted");

  return (
    <>
      <SectionHeader
        title="Compliance"
        subtitle={`${certRows.length} certifications on file${expiring ? ` · ${expiring} expiring within 60 days` : ""} · ${signed.length} signed incident reports`}
      />
      <div className="grid flex-1 grid-cols-2 items-start gap-4 p-7">
        {/* Certifications register */}
        <section className={card}>
          <h2 className={`${cardTitle} mb-3`}>Staff certifications</h2>
          {certRows.length === 0 ? (
            <p className="text-[12.5px] text-faint">
              Nothing on file yet — certifications are added on staff profiles.
            </p>
          ) : (
            <>
              <div className={`grid grid-cols-[1.3fr_1.3fr_1fr] gap-2 border-b border-[#EDF3FB] pb-2 ${th}`}>
                <span>STAFF</span>
                <span>ITEM</span>
                <span>STATUS</span>
              </div>
              {certRows.map((cert, i) => {
                const state = !cert.expires_on
                  ? { label: "On file", cls: "bg-[#E4F3EC] text-success" }
                  : cert.expires_on < today
                    ? { label: "Expired", cls: "bg-danger-bg text-danger" }
                    : cert.expires_on <= soon
                      ? { label: `Expires ${short(cert.expires_on)}`, cls: "bg-warning-bg text-warning-text" }
                      : { label: `Valid · ${short(cert.expires_on)}`, cls: "bg-[#E4F3EC] text-success" };
                return (
                  <div
                    key={`${cert.staffName}-${cert.item}-${i}`}
                    className="grid grid-cols-[1.3fr_1.3fr_1fr] items-center gap-2 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
                  >
                    <span className="truncate text-[12.5px] font-bold text-ink">{cert.staffName}</span>
                    <span className="truncate text-[12.5px] text-muted">{cert.item}</span>
                    <span>
                      <span className={`whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-bold ${state.cls}`}>
                        {state.label}
                      </span>
                    </span>
                  </div>
                );
              })}
            </>
          )}
          <p className="mt-2.5 text-[11.5px] text-faint">
            Automatic expiry reminders arrive with notifications.
          </p>
        </section>

        {/* Incident log */}
        <section className={card}>
          <h2 className={`${cardTitle} mb-3`}>Incident log</h2>
          {signed.length === 0 ? (
            <p className="text-[12.5px] text-faint">No signed reports yet.</p>
          ) : (
            <div className="flex flex-col">
              {signed.map((incident) => (
                <div
                  key={incident.id}
                  className="flex items-center gap-2.5 border-b border-[#EDF3FB] py-2.5 last:border-b-0"
                >
                  <Avatar
                    name={`${incident.child?.first_name ?? ""} ${incident.child?.last_name ?? ""}`}
                    size={28}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-ink">
                      {incident.child?.first_name} {incident.child?.last_name}
                      <span className="font-semibold text-faint">
                        {" "}
                        · {incident.injury_type} · {incident.classroom?.name}
                      </span>
                    </span>
                    <span className="block text-[11px] text-muted">
                      {new Date(incident.occurred_at).toLocaleDateString("en-CA", {
                        month: "short",
                        day: "numeric",
                      })}{" "}
                      · by {incident.educator?.full_name ?? "—"}
                    </span>
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-[3px] text-[11px] font-bold ${
                      incident.parent_acknowledged_at
                        ? "bg-[#E4F3EC] text-success"
                        : "bg-[#E7F0FB] text-primary"
                    }`}
                  >
                    {incident.parent_acknowledged_at ? "Acknowledged" : "Signed"}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2.5 text-[11.5px] text-faint">
            The document vault and printable inspection packs are next on the
            compliance roadmap.
          </p>
        </section>
      </div>
    </>
  );
}

function short(date: string): string {
  return new Date(`${date}T12:00`).toLocaleDateString("en-CA", {
    month: "short",
    year: "numeric",
  });
}
