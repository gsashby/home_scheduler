// Shared by google-calendar-connect (signs) and google-calendar-callback
// (verifies) — the OAuth `state` param round-trips which profile requested
// the connection through Google's redirect, tamper-proofed with HMAC since
// the callback endpoint is public (verify_jwt = false, no caller JWT to
// check the request against).

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const str = atob(padded + pad);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface OAuthStatePayload {
  profile_id: string;
  ts: number;
  nonce: string;
}

// The consent screen round trip should take seconds, not minutes — this
// just bounds how long a captured/replayed state param stays valid.
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

export async function signOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const payloadB64 = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadB64),
  );
  return `${payloadB64}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifyOAuthState(
  state: string,
  secret: string,
): Promise<OAuthStatePayload | null> {
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) return null;

  const key = await hmacKey(secret);
  let valid: boolean;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlDecode(sigB64),
      new TextEncoder().encode(payloadB64),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (typeof payload.profile_id !== "string" || typeof payload.ts !== "number") {
    return null;
  }
  if (Date.now() - payload.ts > STATE_MAX_AGE_MS) return null;

  return payload;
}
