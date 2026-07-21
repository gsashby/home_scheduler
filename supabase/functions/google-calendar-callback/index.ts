// Google redirects the browser here directly after the consent screen —
// public endpoint (verify_jwt = false in supabase/config.toml, auth: "none"
// below), so the `state` param (signed by google-calendar-connect) is what
// ties this request back to a specific profile instead of a caller JWT.
// Exchanges the code for tokens, stores them, and redirects the browser
// back to the app's Settings page.
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";
import { verifyOAuthState } from "../_shared/google-oauth-state.ts";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export default {
  fetch: withSupabase<any>({ auth: "none" }, async (req, ctx) => {
    const siteUrl = Deno.env.get("SITE_URL");
    if (!siteUrl) {
      return Response.json(
        { error: "SITE_URL secret is not set for this Edge Function" },
        { status: 500 },
      );
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const oauthError = url.searchParams.get("error");

    if (oauthError || !code || !state) {
      return Response.redirect(`${siteUrl}/settings?google=error`, 302);
    }

    const stateSecret = Deno.env.get("GOOGLE_OAUTH_STATE_SECRET");
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!stateSecret || !clientId || !clientSecret || !supabaseUrl) {
      return Response.json(
        { error: "Google Calendar OAuth is not configured" },
        { status: 500 },
      );
    }

    const parsedState = await verifyOAuthState(state, stateSecret);
    if (!parsedState) {
      return Response.redirect(`${siteUrl}/settings?google=error`, 302);
    }

    const redirectUri = `${supabaseUrl}/functions/v1/google-calendar-callback`;
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      console.error("Google token exchange failed:", await tokenRes.text());
      return Response.redirect(`${siteUrl}/settings?google=error`, 302);
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    if (!tokens.refresh_token) {
      // access_type=offline + prompt=consent (see google-calendar-connect)
      // should always yield one — without it we can't refresh later, so
      // treat this as an error rather than silently degrading.
      console.error("Google token exchange returned no refresh_token");
      return Response.redirect(`${siteUrl}/settings?google=error`, 302);
    }

    const { data: profile, error: profileErr } = await ctx.supabaseAdmin
      .from("profiles")
      .select("family_id")
      .eq("id", parsedState.profile_id)
      .maybeSingle();

    if (profileErr || !profile?.family_id) {
      return Response.redirect(`${siteUrl}/settings?google=error`, 302);
    }

    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const { error: upsertErr } = await ctx.supabaseAdmin
      .from("google_tokens")
      .upsert({
        profile_id: parsedState.profile_id,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expiry,
        scope: tokens.scope,
        family_id: profile.family_id,
      });

    if (upsertErr) {
      console.error("Failed to store Google tokens:", upsertErr);
      return Response.redirect(`${siteUrl}/settings?google=error`, 302);
    }

    return Response.redirect(`${siteUrl}/settings?google=connected`, 302);
  }),
};
