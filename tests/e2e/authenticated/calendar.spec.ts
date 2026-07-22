import { expect, test } from "@playwright/test";
import { SEEDED, uniqueTitle } from "./helpers";

// Calendar event CRUD as a parent: add -> edit -> delete. The page refetches
// (load()) after each save/delete via the modal's onSaved/onDeleted, so
// these assertions don't depend on Realtime timing. Writes go straight to
// calendar_events under RLS (family-scoped) — see Documentation/03-frontend.md.

test.describe("calendar (Mom)", () => {
  test.use({ storageState: SEEDED.parent.storageState });

  test("add, edit, then delete an event", async ({ page }, testInfo) => {
    const title = uniqueTitle("E2E event", testInfo.workerIndex);
    const edited = `${title} (edited)`;

    await page.goto("/calendar");

    // --- Add (defaults: owner = me, date = today, 16:00–17:00) ------------
    await page.getByRole("button", { name: "+ Add event" }).click();
    await page
      .getByPlaceholder("e.g., Work shift, Practice, Appointment")
      .fill(title);
    await page.getByRole("button", { name: "Add event", exact: true }).click();
    // Default view is the week grid; the new event lands in today's column.
    await expect(page.getByText(title)).toBeVisible();

    // --- Edit its title --------------------------------------------------
    await page.getByText(title).click();
    await expect(
      page.getByRole("heading", { name: "Edit event" }),
    ).toBeVisible();
    await page
      .getByPlaceholder("e.g., Work shift, Practice, Appointment")
      .fill(edited);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(edited)).toBeVisible();

    // --- Delete ----------------------------------------------------------
    await page.getByText(edited).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page.getByText(edited)).toHaveCount(0);
  });
});
