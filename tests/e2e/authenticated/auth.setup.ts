import { mkdir } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { test as setup } from "@playwright/test";
import { AUTH_DIR, SEEDED, signInViaUi } from "./helpers";

// Runs once, before the `authenticated` project, as its dependency (see
// playwright.config.ts). Two jobs:
//   1. Put a known password on the seeded Mom/Sara accounts. The seed
//      (supabase/seed.sql) inserts them with an empty encrypted_password,
//      so they can't be signed into directly — the standard fix is the
//      service-role admin API. Idempotent: safe to re-run every time.
//   2. Sign each in through the real /login form and save the resulting
//      session as Playwright storageState, so the actual specs start
//      already-authenticated instead of each paying the login cost.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

setup("provision seeded accounts and save sessions", async ({ browser }) => {
  // The config only wires this project in when both are set (see
  // authEnabled in playwright.config.ts); this is a belt-and-braces guard.
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "authenticated E2E tier requires NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY — see tests/e2e/authenticated/README.md",
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await mkdir(AUTH_DIR, { recursive: true });

  for (const account of [SEEDED.parent, SEEDED.kid]) {
    const { error } = await admin.auth.admin.updateUserById(account.id, {
      password: account.password,
      email_confirm: true,
    });
    if (error) {
      throw new Error(
        `Could not set a password on seeded account ${account.email} ` +
          `(${account.id}). Is this project seeded from supabase/seed.sql? ` +
          `Underlying error: ${error.message}`,
      );
    }

    // Fresh context per account so their cookies don't cross-contaminate.
    const context = await browser.newContext();
    const page = await context.newPage();
    await signInViaUi(page, account);
    await context.storageState({ path: account.storageState });
    await context.close();
  }
});
