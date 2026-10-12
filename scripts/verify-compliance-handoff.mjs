// Opt-in linked-development test. Creates clearly labelled synthetic vault
// versions and a voided drill, and revokes every share in finally. No deletes.
// Supply SUPABASE_TEST_PASSWORD plus public Supabase URL/key in the environment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { createClient } = require("@supabase/supabase-js");
const { createServerClient } = require("@supabase/ssr");
if (process.env.RUN_LIVE_COMPLIANCE_TESTS !== "1")
  throw new Error(
    "Set RUN_LIVE_COMPLIANCE_TESTS=1 for the development project only.",
  );
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.SUPABASE_TEST_PASSWORD;
assert(
  url && key && password,
  "Public URL/key and test password are required.",
);
const client = () =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const admin = client(),
  educator = client(),
  anonymous = client();
const good = async (result) => {
  const r = await result;
  if (r.error) throw r.error;
  return r.data;
};
const denied = async (result, description) => {
  const r = await result;
  assert(r.error, description);
  pass(description);
};
let checks = 0;
function pass(description) {
  checks++;
  console.log(`PASS ${description}`);
}
await good(
  admin.auth.signInWithPassword({
    email: process.env.SUPABASE_TEST_ADMIN_EMAIL ?? "amara@sunnygrove.test",
    password,
  }),
);
await good(
  educator.auth.signInWithPassword({
    email: process.env.SUPABASE_TEST_EDUCATOR_EMAIL ?? "maria@sunnygrove.test",
    password,
  }),
);
const profile = await good(
  admin
    .from("profiles")
    .select("id,daycare_id")
    .eq("id", (await admin.auth.getUser()).data.user.id)
    .single(),
);
const pack = await good(admin.rpc("get_compliance_inspection_pack"));
assert(Array.isArray(pack.staff) && pack.staff.length > 0);
pass("Admin pack reads the existing staff register");
await denied(
  educator.rpc("get_compliance_inspection_pack"),
  "Educator cannot read the center inspection pack",
);
await denied(
  anonymous.rpc("get_compliance_inspection_pack"),
  "Anonymous caller cannot read the private pack",
);
await denied(
  educator.rpc("create_compliance_inspection_share", {
    p_label: "Not authorized",
  }),
  "Educator cannot create inspection shares",
);
await denied(
  anonymous.rpc("read_compliance_inspection_share", {
    p_token: "0".repeat(64),
  }),
  "Unknown share tokens fail closed",
);
const hidden = await good(educator.from("compliance_documents").select("id"));
assert.equal(hidden.length, 0);
pass("Educator cannot list vault metadata");

const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
const marker = "Synthetic compliance verification (not an official document)";
const all = await good(
  admin.from("compliance_documents").select("id,replaces_id,title,version"),
);
const replaced = new Set(all.map((d) => d.replaces_id));
let current = all.find((d) => d.title === marker && !replaced.has(d.id));
let drillId;
const shares = [];
let latestId;
async function upload(include, replace) {
  const path = `${profile.daycare_id}/${profile.id}/${crypto.randomUUID()}.png`;
  await good(
    admin.storage
      .from("compliance-vault")
      .upload(path, bytes, { contentType: "image/png" }),
  );
  const id = await good(
    admin.rpc("save_compliance_document", {
      p_title: marker,
      p_category: "other",
      p_storage_path: path,
      p_watch_expiry: false,
      p_include_in_inspection: include,
      ...(replace ? { p_replaces_id: replace } : {}),
    }),
  );
  latestId = id;
  return { id, path };
}
async function edge(token, id) {
  return fetch(`${url}/functions/v1/compliance-inspection-document`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ token, documentId: id }),
  });
}
try {
  const first = await upload(true, current?.id);
  current = { id: first.id };
  const saved = await good(
    admin.from("compliance_documents").select("*").eq("id", first.id).single(),
  );
  assert.equal(saved.size_bytes, bytes.length);
  assert.equal(saved.mime_type, "image/png");
  pass("Vault metadata comes from the actual private upload");
  await denied(
    admin.rpc("save_compliance_document", {
      p_title: "Missing file",
      p_category: "other",
      p_storage_path: `${profile.daycare_id}/${profile.id}/missing.png`,
    }),
    "Unuploaded document metadata is rejected",
  );
  await denied(
    admin.rpc("save_compliance_document", {
      p_title: "Wrong center",
      p_category: "other",
      p_storage_path: `${crypto.randomUUID()}/${profile.id}/file.png`,
    }),
    "Cross-center upload paths are rejected",
  );
  const educatorId = (await educator.auth.getUser()).data.user.id;
  await denied(
    educator.storage
      .from("compliance-vault")
      .upload(
        `${profile.daycare_id}/${educatorId}/${crypto.randomUUID()}.png`,
        bytes,
        { contentType: "image/png" },
      ),
    "Educator cannot upload into the admin vault",
  );
  const update = await good(
    admin
      .from("compliance_documents")
      .update({ title: "Changed" })
      .eq("id", first.id)
      .select("id"),
  );
  assert.equal(update.length, 0);
  pass("Saved vault records cannot be edited in place");
  await good(admin.storage.from("compliance-vault").remove([first.path]));
  assert(
    (await admin.storage.from("compliance-vault").download(first.path)).data,
  );
  pass("Referenced originals cannot be deleted");
  await denied(
    anonymous.storage.from("compliance-vault").download(first.path),
    "Vault files are not publicly downloadable",
  );

  const share = await good(
    admin.rpc("create_compliance_inspection_share", {
      p_label: "Synthetic verification — revoked automatically",
    }),
  );
  shares.push(share.id);
  assert(
    Math.abs(Date.parse(share.expires_at) - Date.now() - 48 * 3600000) < 60000,
  );
  pass("Inspection shares expire after 48 hours");
  const publicPack = await good(
    anonymous.rpc("read_compliance_inspection_share", { p_token: share.token }),
  );
  assert(publicPack.documents.some((d) => d.id === first.id));
  assert(!JSON.stringify(publicPack).includes("storage_path"));
  pass("Valid share returns live selected records without storage paths");
  const response = await edge(share.token, first.id);
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, bytes.length);
  pass("Shared original downloads through the validated private-file gateway");
  assert.equal((await edge(share.token, crypto.randomUUID())).status, 404);
  pass("A share cannot fetch an arbitrary document");

  const second = await upload(true, first.id);
  current = { id: second.id };
  const updatedPack = await good(
    anonymous.rpc("read_compliance_inspection_share", { p_token: share.token }),
  );
  assert(updatedPack.documents.some((d) => d.id === second.id));
  assert(!updatedPack.documents.some((d) => d.id === first.id));
  pass("Existing share follows the newest document version");
  assert.equal((await edge(share.token, first.id)).status, 404);
  pass("Superseded versions disappear from shared downloads");
  await denied(
    admin.rpc("save_compliance_document", {
      p_title: marker,
      p_category: "other",
      p_storage_path: second.path,
      p_replaces_id: first.id,
    }),
    "Replacing a stale version is rejected",
  );
  const internal = await upload(false, second.id);
  current = { id: internal.id };
  const internalPack = await good(
    anonymous.rpc("read_compliance_inspection_share", { p_token: share.token }),
  );
  assert(!internalPack.documents.some((d) => d.title === marker));
  assert.equal((await edge(share.token, internal.id)).status, 404);
  pass("Internal-only replacement is excluded from every share");
  const shareList = await good(admin.rpc("list_compliance_inspection_shares"));
  assert(shareList.find((s) => s.id === share.id)?.last_opened_at);
  assert(!JSON.stringify(shareList).includes("token_hash"));
  pass("Share opens are tracked without exposing token hashes");
  await good(
    admin.rpc("revoke_compliance_inspection_share", { p_id: share.id }),
  );
  shares.splice(shares.indexOf(share.id), 1);
  await denied(
    anonymous.rpc("read_compliance_inspection_share", { p_token: share.token }),
    "Revoked share cannot reopen the pack",
  );
  assert.equal((await edge(share.token, second.id)).status, 404);
  pass("Revocation also closes the document gateway");

  const lead = pack.staff[0].id;
  const drill = {
    p_kind: "fire",
    p_conducted_local: `${pack.today}T00:00:00`,
    p_lead_staff_id: lead,
    p_duration_seconds: 128,
    p_children_count: 9999,
    p_staff_count: 1,
  };
  await denied(
    admin.rpc("log_compliance_drill", drill),
    "Headcount mismatch requires an explanatory note",
  );
  await denied(
    admin.rpc("log_compliance_drill", {
      ...drill,
      p_conducted_local: "2099-01-01T10:00:00",
      p_notes: "Synthetic test",
    }),
    "Future drills are rejected",
  );
  await denied(
    educator.rpc("log_compliance_drill", {
      ...drill,
      p_notes: "Synthetic test",
    }),
    "Educator cannot create an admin drill record",
  );
  await denied(
    admin.rpc("log_compliance_drill", {
      ...drill,
      p_children_count: 0,
      p_notes: "Synthetic test: no actual drill occurred.",
      p_next_due_on: pack.today,
    }),
    "Next drill must be scheduled after the recorded drill",
  );
  drillId = await good(
    admin.rpc("log_compliance_drill", {
      p_kind: "fire",
      p_conducted_local: `${pack.today}T00:00:00`,
      p_lead_staff_id: pack.staff[0].id,
      p_duration_seconds: 128,
      p_children_count: 0,
      p_staff_count: 1,
      p_notes:
        "Synthetic test: no actual drill occurred. Voided automatically after verification.",
    }),
  );
  assert(
    (await good(admin.rpc("get_compliance_inspection_pack"))).drills.some(
      (d) => d.id === drillId,
    ),
  );
  pass("Saved drill reaches the inspection pack");
  const edits = await good(
    admin
      .from("compliance_drills")
      .update({ children_count: 100 })
      .eq("id", drillId)
      .select("id"),
  );
  assert.equal(edits.length, 0);
  pass("Recorded drill counts cannot be silently rewritten");
} finally {
  if (drillId)
    await good(
      admin.rpc("void_compliance_drill", {
        p_id: drillId,
        p_reason:
          "Synthetic integration verification; no actual drill took place.",
      }),
    );
  for (const id of shares)
    await admin.rpc("revoke_compliance_inspection_share", { p_id: id });
  if (latestId) {
    const row = await good(
      admin
        .from("compliance_documents")
        .select("include_in_inspection")
        .eq("id", latestId)
        .single(),
    );
    if (row.include_in_inspection) await upload(false, latestId);
  }
}
const finalPack = await good(admin.rpc("get_compliance_inspection_pack"));
assert(finalPack.drills.find((d) => d.id === drillId)?.voided_at);
pass("Corrections retain the original drill and the void reason");
const audit = await good(
  admin
    .from("audit_log")
    .select("action")
    .eq("entity_type", "compliance_drills")
    .eq("entity_id", drillId),
);
assert(
  audit.some((a) => a.action === "insert") &&
    audit.some((a) => a.action === "update"),
);
pass("Drill creation and correction are audited");

// Exercise real server routes using a fresh in-memory SSR session. This does
// not access, alter or export the user's browser session/cookie store.
if (process.env.TEST_WEB_ORIGIN) {
  const jar = new Map();
  const ssr = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach((c) => jar.set(c.name, c.value)),
    },
  });
  await good(
    ssr.auth.signInWithPassword({
      email: process.env.SUPABASE_TEST_ADMIN_EMAIL ?? "amara@sunnygrove.test",
      password,
    }),
  );
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join("; ");
  for (const [path, marker] of [
    ["/compliance", "Document vault"],
    ["/compliance/inspection", "Inspection pack"],
    ["/dashboard", "Needs your attention"],
  ]) {
    const r = await fetch(`${process.env.TEST_WEB_ORIGIN}${path}`, {
      headers: { Cookie: cookie },
    });
    assert.equal(r.status, 200);
    assert((await r.text()).includes(marker));
    pass(`Authenticated ${path} renders without a server error`);
  }
  const privateRoute = await fetch(
    `${process.env.TEST_WEB_ORIGIN}/compliance`,
    { redirect: "manual" },
  );
  assert.equal(privateRoute.status, 307);
  pass("Signed-out admin route redirects to sign-in");
  const invalid = await fetch(
    `${process.env.TEST_WEB_ORIGIN}/inspection/${"0".repeat(64)}`,
  );
  assert((await invalid.text()).includes("Inspection link unavailable"));
  pass("Invalid public link renders a recovery screen");
}
console.log(
  `Compliance handoff: ${checks} checks passed. Synthetic originals retained internally; test drill voided; all test shares revoked.`,
);
