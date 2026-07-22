import { expect, test } from "@playwright/test";
import { card, SEEDED, uniqueTitle } from "./helpers";

// The core assign -> done -> verify state machine, exercised across two real
// sessions (parent + kid) so it confirms the RPC + RLS + UI wiring end to
// end, not just one role's view. Each RPC (assign via insert, mark_task_done,
// verify_task) is SECURITY DEFINER and re-checks the caller's role — see
// Documentation/02-database-schema.md.

test("parent assigns a task, kid marks it done, parent verifies it", async ({
  browser,
}, testInfo) => {
  const title = uniqueTitle("E2E task", testInfo.workerIndex);

  const parent = await browser.newContext({
    storageState: SEEDED.parent.storageState,
  });
  const kid = await browser.newContext({
    storageState: SEEDED.kid.storageState,
  });
  const parentPage = await parent.newPage();
  const kidPage = await kid.newPage();

  try {
    // --- Parent assigns the task to Sara ---------------------------------
    await parentPage.goto("/tasks");
    await parentPage.getByRole("button", { name: /Assign task/ }).click();
    await parentPage
      .getByPlaceholder("e.g., Math, Clean your room, Work schedule")
      .fill(title);
    // First combobox in the assign modal is "Assign to".
    await parentPage
      .getByRole("combobox")
      .first()
      .selectOption({ label: SEEDED.kid.displayName });
    await parentPage.getByRole("button", { name: "Assign", exact: true }).click();

    const parentRow = card(parentPage, title);
    await expect(parentRow).toBeVisible();
    // StatusBadge renders "assigned" as the label "to do" (see
    // src/components/ui.tsx). Realtime (the tasks-changes channel) reloads
    // the list after create_task, so this settles without a manual reload.
    await expect(parentRow.getByText("to do")).toBeVisible();

    // --- Kid sees it and marks it done -----------------------------------
    await kidPage.goto("/tasks");
    const kidRow = card(kidPage, title);
    await expect(kidRow).toBeVisible();
    await kidRow.getByRole("button", { name: "✓ Mark done" }).click();
    // mark_task_done flips status to "done"; the kid's own action button is
    // replaced by the waiting-for-verify note.
    await expect(
      kidRow.getByText("Waiting for parent to verify"),
    ).toBeVisible();

    // --- Parent verifies -------------------------------------------------
    await parentPage.reload();
    const toVerify = card(parentPage, title);
    await toVerify.getByRole("button", { name: "✓ Verify" }).click();
    // verify_task moves it to "verified": the Verify button is gone, and the
    // card drops into the "Done / verified" section with that badge.
    await expect(toVerify.getByRole("button", { name: "✓ Verify" })).toHaveCount(
      0,
    );
    await expect(card(parentPage, title).getByText("verified")).toBeVisible();
  } finally {
    await parent.close();
    await kid.close();
  }
});
