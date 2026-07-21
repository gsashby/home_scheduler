// Called by the logged-in browser client (supabase.functions.invoke) from
// the Settings page's "Connect Google Calendar" button. Always connects the
// caller's OWN account — there's no target-profile parameter — since each
// family member connects their own Google Calendar (see
// src/app/(app)/settings/page.tsx). Returns a Google OAuth consent URL for
// the client to redirect the browser to; google-calendar-callback handles
// the redirect back from Google.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { signOAuthState } from "../_shared/google-oauth-state.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/calendar";

export default {
  fetch: withSupabase<any>({ auth: "user" }, async (_req, ctx) => {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const stateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");

    if (!clientId || !stateSecret || !supabaseUrl) {
      return Response.json(
        { error: "Google Calendar OAuth is not configured" },
        { status: 500 },
      );
    }

    const profileId = ctx.userClaims!.id;
    const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-callback`;

    const state = await signOAuthState(
      { profile_id: profileId, ts: Date.now(), nonce: crypto.randomUUID() },
      stateSecret,
    );

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPE,
      // access_type=offline + prompt=consent forces Google to hand back a
      // refresh_token on every connect, not just the first time this user
      // ever authorized this OAuth client.
      access_type: "offline",
      prompt: "consent",
      state,
    });

    return Response.json({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
  }),
};
