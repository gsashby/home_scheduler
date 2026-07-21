import { expect, test } from "@playwright/test";

test("/login renders both sign-in methods", async ({ page }) => {
  await page.goto("/login");
  await expect(
    page.getByRole("button", { name: "Sign in with Google" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Forgot your password?" }),
  ).toHaveAttribute("href", "/auth/reset-password");
  await expect(
    page.getByRole("link", { name: "Create an account" }),
  ).toHaveAttribute("href", "/signup");
});

test("/login shows the denied banner when redirected with ?denied=1", async ({
  page,
}) => {
  await page.goto("/login?denied=1");
  await expect(
    page.getByText("set up as a family member on this app"),
  ).toBeVisible();
});

test("/signup renders both sign-up methods", async ({ page }) => {
  await page.goto("/signup");
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Your name")).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(
    page.getByPlaceholder("Password (min. 8 characters)"),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    "/login",
  );
});

test("/signup blocks submission of a too-short password", async ({ page }) => {
  // The password input's native `minLength={8}` stops the browser from
  // ever submitting the form, so the component's own
  // `password.length < 8` check (src/app/signup/page.tsx) is a redundant
  // backstop, not something reachable through normal UI interaction. What
  // actually matters to a user: submitting stays on /signup instead of
  // proceeding to onboarding.
  await page.goto("/signup");
  await page.getByPlaceholder("Your name").fill("Test Kid");
  await page.getByPlaceholder("Email").fill("test@example.com");
  await page.getByPlaceholder("Password (min. 8 characters)").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test("/auth/reset-password renders the request form", async ({ page }) => {
  await page.goto("/auth/reset-password");
  await expect(page.getByPlaceholder("Email")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send reset link" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to sign in" }),
  ).toHaveAttribute("href", "/login");
});

test("/auth/update-password shows an expired-link message with no session", async ({
  page,
}) => {
  await page.goto("/auth/update-password");
  await expect(
    page.getByText("This reset link is invalid or has expired."),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Request a new reset link" }),
  ).toHaveAttribute("href", "/auth/reset-password");
});
