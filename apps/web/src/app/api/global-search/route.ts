import { getMyProfile } from "@dailylog/db/queries";
import { getServerSupabase } from "@/lib/supabase/server";

export interface GlobalSearchResult {
  id: string;
  section: "Children" | "Staff" | "Family & billing" | "Actions";
  title: string;
  subtitle: string;
  href: string;
  initials?: string;
  tone?: "blue" | "amber" | "green" | "purple";
}

function safeTerm(value: string): string {
  return value.trim().replace(/[,%_()]/g, " ").replace(/\s+/g, " ").slice(0, 80);
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export async function GET(request: Request) {
  const query = safeTerm(new URL(request.url).searchParams.get("q") ?? "");
  if (query.length < 2) return Response.json({ results: [] });

  const supabase = await getServerSupabase();
  const profile = await getMyProfile(supabase);
  if (!profile?.daycare_id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const pattern = `%${query}%`;
  const [childrenResponse, staffResponse, familyResponse, invoiceResponse] = await Promise.all([
    supabase
      .from("children")
      .select("id, first_name, last_name, classroom:classrooms(id, name)")
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`)
      .is("archived_at", null)
      .order("first_name")
      .limit(6),
    supabase
      .from("staff_members")
      .select("id, job_title, profile:profiles!inner(id, full_name, role, classroom:classrooms!profiles_classroom_id_fkey(id, name))")
      .ilike("profile.full_name", pattern)
      .is("archived_at", null)
      .limit(5),
    supabase
      .from("families")
      .select("id, display_name, children:family_children(child:children(id, first_name, last_name))")
      .ilike("display_name", pattern)
      .order("display_name")
      .limit(5),
    supabase
      .from("invoices")
      .select("id, number, status, total_cents, due_on, family:families(id, display_name)")
      .ilike("number", pattern)
      .order("issued_on", { ascending: false })
      .limit(5),
  ]);

  const failed = [childrenResponse, staffResponse, familyResponse, invoiceResponse].find(
    (response) => response.error,
  );
  if (failed?.error) return Response.json({ error: failed.error.message }, { status: 500 });

  const results: GlobalSearchResult[] = [];
  for (const child of childrenResponse.data ?? []) {
    const name = `${child.first_name} ${child.last_name}`;
    const room = child.classroom as unknown as { name: string } | null;
    results.push({
      id: `child:${child.id}`,
      section: "Children",
      title: name,
      subtitle: room?.name ? `${room.name} · open profile` : "Open child profile",
      href: `/children/${child.id}`,
      initials: initials(name),
      tone: "blue",
    });
  }
  for (const member of staffResponse.data ?? []) {
    const staffProfile = member.profile as unknown as {
      full_name: string;
      role: string;
      classroom: { name: string } | null;
    };
    const room = staffProfile.classroom;
    results.push({
      id: `staff:${member.id}`,
      section: "Staff",
      title: staffProfile.full_name,
      subtitle: `${member.job_title ?? (staffProfile.role === "educator" ? "Educator" : "Administrator")}${room?.name ? ` · ${room.name}` : ""}`,
      href: `/staff/${member.id}`,
      initials: initials(staffProfile.full_name),
      tone: "green",
    });
  }
  for (const family of familyResponse.data ?? []) {
    const links = family.children as unknown as Array<{
      child: { id: string; first_name: string; last_name: string } | null;
    }>;
    const child = links?.find((link) => link.child)?.child;
    results.push({
      id: `family:${family.id}`,
      section: "Family & billing",
      title: family.display_name,
      subtitle: `${links?.filter((link) => link.child).length ?? 0} linked child${(links?.filter((link) => link.child).length ?? 0) === 1 ? "" : "ren"} · family record`,
      href: child ? `/children/${child.id}` : "/billing",
      initials: initials(family.display_name),
      tone: "amber",
    });
  }
  for (const invoice of invoiceResponse.data ?? []) {
    const family = invoice.family as unknown as { display_name: string } | null;
    results.push({
      id: `invoice:${invoice.id}`,
      section: "Family & billing",
      title: `Invoice ${invoice.number ?? "draft"}`,
      subtitle: `${family?.display_name ?? "Family"} · ${(invoice.total_cents / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" })} · ${invoice.status}`,
      href: `/billing?invoice=${invoice.id}`,
      initials: "$",
      tone: invoice.status === "open" ? "amber" : "purple",
    });
  }

  const firstChild = childrenResponse.data?.[0];
  if (firstChild) {
    const childName = `${firstChild.first_name} ${firstChild.last_name}`;
    results.push(
      {
        id: `action:message:${firstChild.id}`,
        section: "Actions",
        title: `Message ${firstChild.first_name}'s family`,
        subtitle: `Start or open the family conversation for ${childName}`,
        href: `/messages?child=${firstChild.id}`,
        tone: "blue",
      },
      {
        id: `action:attendance:${firstChild.id}`,
        section: "Actions",
        title: `Open attendance for ${firstChild.first_name}`,
        subtitle: "Review arrival status or record today's attendance",
        href: "/attendance",
        tone: "amber",
      },
    );
  }

  return Response.json({ results: results.slice(0, 18) });
}
