import { expect, test } from "@playwright/test";

// (app)/layout.tsx and onboarding/layout.tsx both call
// supabase.auth.getUser() server-side and redirect to /login on any
// failure/no-session result -- see the comment in playwright.config.ts
// for why this is testable without a real Supabase backend.
const protectedRoutes = [
  "/",
  "/calendar",
  "/jobs",
  "/settings",
  "/tasks",
  "/zones",
  "/onboarding/choose",
  "/onboarding/create",
  "/onboarding/join",
  "/onboarding/invite",
];

for (const route of protectedRoutes) {
  test(`${route} redirects an unauthenticated visitor to /login`, async ({
    page,
  }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/login$/);
  });
}
