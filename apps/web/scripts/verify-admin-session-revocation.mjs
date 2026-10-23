// Opt-in linked-development check using a seeded, disposable test account.
// It creates two sessions, revokes one from the other, and verifies that a
// refresh on the revoked session fails. Never use against a real account.
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";

assert.equal(process.env.RUN_LIVE_SESSION_TESTS, "1", "Explicit live-test opt-in required");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.SUPABASE_TEST_PASSWORD;
assert(url && key && password, "Development Supabase URL/key and test password required");

const client = () => createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const first = client();
const second = client();
let firstSignedIn = false;
try {
  const credentials = {
    email: process.env.SUPABASE_TEST_ADMIN_EMAIL ?? "amara@sunnygrove.test",
    password,
  };
  const firstSignIn = await first.auth.signInWithPassword(credentials);
  if (firstSignIn.error) throw firstSignIn.error;
  firstSignedIn = true;
  const secondSignIn = await second.auth.signInWithPassword(credentials);
  if (secondSignIn.error) throw secondSignIn.error;

  const firstSession = firstSignIn.data.session;
  const secondSession = secondSignIn.data.session;
  assert(firstSession && secondSession, "Both test sign-ins must create sessions");
  const sessionId = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).session_id;
  const firstId = sessionId(firstSession.access_token);
  const secondId = sessionId(secondSession.access_token);
  assert(firstId && secondId && firstId !== secondId, "Distinct test sessions required");

  const notice = await first.from("notifications")
    .select("id")
    .eq("kind", "new_device_sign_in")
    .contains("payload", { session_id: secondId })
    .limit(1);
  if (notice.error) throw notice.error;
  assert.equal(notice.data?.length, 1, "Second sign-in must produce a security notice");
  console.log("PASS: real sign-in created a security notice");

  const revoke = await first.rpc("end_my_admin_session", { p_session_id: secondId });
  if (revoke.error) throw revoke.error;
  assert.equal(revoke.data, true, "First session must revoke the second");
  const refresh = await second.auth.refreshSession();
  assert(refresh.error, "Revoked session must not refresh");
  const stillActive = await first.auth.getUser();
  if (stillActive.error) throw stillActive.error;
  assert(stillActive.data.user, "Current session must remain usable");
  console.log("PASS: revoked session cannot refresh; current session remains active");
} finally {
  if (firstSignedIn) await first.auth.signOut({ scope: "local" });
}
