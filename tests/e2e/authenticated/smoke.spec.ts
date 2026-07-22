import { expect, test } from "@playwright/test";
import { FAMILY_NAME, SEEDED } from "./helpers";

// Signed-in landing + role-scoped navigation. Both accounts reuse the
// storageState saved by auth.setup.ts, so these start already on the app
// side of the auth guard. Tab links have unique accessible names, so
// asserting on them is unambiguous (unlike a member's display name, which
// can appear in several places on the Today page).

test.describe("parent (Mom)", () => {
  test.use({ storageState: SEEDED.parent.storageState });

  test("lands on Today and sees the full parent nav", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    // The family-name chip lives in the header (visible at desktop widths).
    await expect(page.locator("header").getByText(FAMILY_NAME)).toBeVisible();
    // Parents get every tab, including the two kids never see.
    for (const tab of [
      "Today",
      "Calendar",
      "Tasks",
      "Zones",
      "Job Board",
      "Settings",
    ]) {
      await expect(page.getByRole("link", { name: tab })).toBeVisible();
    }
  });
});

test.describe("kid (Sara)", () => {
  test.use({ storageState: SEEDED.kid.storageState });

  test("lands on Today but has no Zones or Settings tab", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Job Board" })).toBeVisible();
    // Shell only renders Zones/Settings for parents (isParent) — the UI
    // half of the Postgres-enforced rule that kids can't manage those.
    await expect(page.getByRole("link", { name: "Zones" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);
  });
});
