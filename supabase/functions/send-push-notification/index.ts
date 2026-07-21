// Phase 5b — first Edge Function in this codebase. Invoked by
// notify_push_webhook() (see supabase/migrations/0012_push_notifications.sql)
// via pg_net whenever a message/pending-connection/like/comment is inserted.
// Not reachable from the app directly — see CONVENTIONS.md.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildExpoPushMessages,
  buildNotificationContent,
  batchMessages,
  findDeadTokens,
  type WebhookPayload,
} from "./lib.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  // SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are auto-provisioned for every
  // Edge Function by the platform — nothing to configure manually. This
  // client bypasses RLS, same as any other service-role client in this repo.
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Proves this request came from our own notify_push_webhook() trigger, not
  // a public POST to this function's URL — see the migration for how this
  // secret is generated/stored (Vault, never hardcoded) and CONVENTIONS.md
  // for why a custom header rather than verify_jwt: the trigger has no real
  // user JWT to send, and verify_jwt only proves "some project key", not
  // specifically "our trigger" (a signed-in user's own JWT would also pass it).
  const { data: expectedSecret, error: secretError } = await admin.rpc("get_push_webhook_secret");
  if (secretError || !expectedSecret) {
    return new Response("server misconfigured", { status: 500 });
  }
  const providedSecret = req.headers.get("x-webhook-secret");
  if (providedSecret !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  let payload: WebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  // Defense-in-depth — notify_push_webhook() already excludes this case, but
  // the function shouldn't trust its caller blindly either.
  if (payload.actor_id === payload.recipient_id) {
    return new Response("ok", { status: 200 });
  }

  const [{ data: actor }, { data: tokenRows }] = await Promise.all([
    admin.from("profiles").select("username, display_name").eq("id", payload.actor_id).single(),
    admin.from("push_tokens").select("expo_push_token").eq("profile_id", payload.recipient_id),
  ]);

  const tokens = (tokenRows ?? []).map((r) => r.expo_push_token);
  if (tokens.length === 0) {
    return new Response("ok", { status: 200 }); // recipient has no registered devices
  }

  const actorName = actor?.display_name ?? actor?.username ?? "Someone";
  const content = buildNotificationContent(payload.table, actorName);
  const messages = buildExpoPushMessages(tokens, content, payload);

  const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
  const expoHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  };
  // Only needed if this Expo project has "enhanced security" enabled
  // (requires an EAS project, which doesn't exist yet for this app — see
  // CONVENTIONS.md). Read from an Edge Function secret if/when it does,
  // never hardcoded.
  if (expoAccessToken) {
    expoHeaders.Authorization = `Bearer ${expoAccessToken}`;
  }

  const deadTokens: string[] = [];
  for (const batch of batchMessages(messages)) {
    const batchTokens = batch.map((m) => m.to);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: expoHeaders,
        body: JSON.stringify(batch),
      });
      const json = await res.json();
      const tickets = json?.data ?? [];
      deadTokens.push(...findDeadTokens(batchTokens, tickets));
    } catch (err) {
      console.error("expo push batch failed", err);
      // best-effort — one failed batch shouldn't block cleanup of other batches
    }
  }

  if (deadTokens.length > 0) {
    await admin.from("push_tokens").delete().in("expo_push_token", deadTokens);
  }

  return new Response("ok", { status: 200 });
});
