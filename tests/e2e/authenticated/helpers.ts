import path from "node:path";
import { expect, type Page } from "@playwright/test";

// Shared plumbing for the authenticated E2E tier. See ./README.md for the
// backend prerequisites (a real or `supabase start` project, seeded from
// supabase/seed.sql, plus SUPABASE_SERVICE_ROLE_KEY).

// storageState files land under tests/e2e/.auth/, which .gitignore already
// excludes (they hold a signed-in session for a seeded account). __dirname
// is this file's dir (tests/e2e/authenticated) — Playwright transpiles
// specs to CommonJS, so __dirname is the portable choice here.
export const AUTH_DIR = path.join(__dirname, "..", ".auth");

// The two seeded Petersons accounts these specs drive, from
// supabase/seed.sql. Mom is a parent (sees Zones/Settings, can assign/
// verify/pay); Sara is a kid (marks own tasks done, takes jobs). UUIDs are
// the stable seed IDs; passwords are set on these accounts by auth.setup.ts
// via the service-role admin API (the seed leaves encrypted_password empty).
export const SEEDED = {
  parent: {
    id: "22222222-2222-2222-2222-222222222222",
    email: "mom@example.com",
    password: "e2e-parent-password-1",
    displayName: "Mom",
    storageState: path.join(AUTH_DIR, "parent.json"),
  },
  kid: {
    id: "33333333-3333-3333-3333-333333333333",
    email: "sara@example.com",
    password: "e2e-kid-password-1",
    displayName: "Sara",
    storageState: path.join(AUTH_DIR, "kid.json"),
  },
} as const;

export const FAMILY_NAME = "The Petersons";

/**
 * Sign in through the real /login form (the app's browser Supabase client
 * writes the @supabase/ssr session cookies, which is exactly what the
 * server-side (app) layout guard reads back). Lands on Today ("/").
 */
export async function signInViaUi(
  page: Page,
  account: { email: string; password: string },
) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(account.email);
  await page.getByPlaceholder("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  // signInWithPassword success does `window.location.href = "/"`; the (app)
  // layout then renders the Today tab. Assert we actually cleared /login.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
}

/** A task/job/event row (all rendered as the same white bordered card). */
export function card(page: Page, text: string) {
  return page
    .locator("div.rounded-lg.border.border-gray-200.bg-white")
    .filter({ hasText: text });
}

/**
 * A title unique to one test run so a spec's assertions can't collide with
 * seed data or a previous run's leftovers. `index` keeps parallel workers
 * apart without Date.now() (kept deterministic-ish via the worker index the
 * caller passes in).
 */
export function uniqueTitle(prefix: string, index: number) {
  return `${prefix} ${index}-${process.pid}`;
}
