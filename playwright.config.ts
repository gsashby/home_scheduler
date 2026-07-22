import { defineConfig, devices } from "@playwright/test";

// Two tiers of tests live under tests/e2e, split by whether they need a
// real (or `supabase start` local) Supabase project:
//
// - tests/e2e/*.spec.ts — run against a syntactically-valid but
//   unreachable NEXT_PUBLIC_SUPABASE_URL (see webServer.env below). No
//   real backend needed: this only exercises public-page rendering and
//   the (app)/(onboarding) layout auth guards, which redirect to /login
//   whenever the Supabase session lookup fails or returns no user —
//   whether that's "no backend" or "no session" is indistinguishable to
//   the guard, so this is a legitimate, fully offline-verifiable test of
//   that behavior.
// - tests/e2e/authenticated/*.spec.ts — need a real project (sign-in,
//   RLS-scoped data, RPCs). These run ONLY when SUPABASE_SERVICE_ROLE_KEY
//   (plus the real URL/anon key) is present; otherwise the whole tier is
//   omitted and `npm run test:e2e` behaves exactly as before. See
//   tests/e2e/authenticated/README.md.
const authEnabled =
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      // Public pages + auth guards + service-worker registration. Never
      // touches the authenticated tier.
      name: "chromium",
      testIgnore: ["**/authenticated/**"],
      use: { ...devices["Desktop Chrome"] },
    },
    // The authenticated tier: a setup project provisions/signs-in the
    // seeded accounts (saving storageState), then the specs depend on it.
    ...(authEnabled
      ? [
          {
            name: "auth-setup",
            testMatch: /authenticated\/auth\.setup\.ts$/,
            use: { ...devices["Desktop Chrome"] },
          },
          {
            name: "authenticated",
            testDir: "./tests/e2e/authenticated",
            testIgnore: ["**/auth.setup.ts"],
            dependencies: ["auth-setup"],
            use: { ...devices["Desktop Chrome"] },
          },
        ]
      : []),
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: authEnabled
      ? {
          // Authenticated tier: point the app at the real/local project the
          // service-role key belongs to.
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
          NEXT_PUBLIC_SUPABASE_ANON_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        }
      : {
          // Deliberately unreachable but well-formed, so createBrowserClient/
          // createServerClient don't throw at construction time — see the
          // comment above. Real values are never needed for this test tier.
          NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon-key-for-e2e-tests-only",
        },
  },
});
