// Shared by google-calendar-list, google-calendar-select, and
// google-calendar-sync — all three need a live (non-expired) Google access
// token for a profile's connected account, refreshing + persisting it via
// the stored refresh_token when the cached one has expired.
//
// `supabaseAdmin` is intentionally untyped (`any`) rather than imported as
// `SupabaseClient<Database>` — these Edge Functions run under Deno,
// separate from the Next.js app's generated Database type, and follow the
// same loose-typing-plus-runtime-interface convention already used by
// send-push/send-invite (see e.g. PushSubscriptionRow there).
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Refresh a little early so a request in flight doesn't race the expiry.
const EXPIRY_SKEW_MS = 60 * 1000;

interface GoogleTokenRow {
  access_token: string;
  refresh_token: string;
  expiry: string;
}

export type AccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; error: string };

// deno-lint-ignore no-explicit-any
export async function getValidAccessToken(
  supabaseAdmin: any,
  profileId: string,
): Promise<AccessTokenResult> {
  const { data: row, error } = await supabaseAdmin
    .from("google_tokens")
    .select("access_token, refresh_token, expiry")
    .eq("profile_id", profileId)
    .maybeSingle() as { data: GoogleTokenRow | null; error: { message: string } | null };

  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "Google Calendar is not connected for this person" };

  if (new Date(row.expiry).getTime() - EXPIRY_SKEW_MS > Date.now()) {
    return { ok: true, accessToken: row.access_token };
  }

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return { ok: false, error: "Google Calendar OAuth is not configured" };
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    return { ok: false, error: `Failed to refresh Google token: ${await res.text()}` };
  }

  const tokens = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from("google_tokens")
    .update({ access_token: tokens.access_token, expiry })
    .eq("profile_id", profileId);

  return { ok: true, accessToken: tokens.access_token };
}
