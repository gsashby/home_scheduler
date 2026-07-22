import { expect, test } from "@playwright/test";
import { card, SEEDED, uniqueTitle } from "./helpers";

// Job board lifecycle across two sessions: parent posts -> kid takes -> kid
// marks done -> parent verifies & pays. Each transition is a SECURITY
// DEFINER RPC (create_job, take_job, job_done, pay_job) with its own role
// check — see Documentation/02-database-schema.md. The jobs page calls
// load() after each RPC, so a given session's own view is deterministic;
// the one cross-session read (parent seeing the kid's "done") is made
// deterministic with an explicit reload rather than leaning on Realtime.

test("parent posts a job, kid takes and finishes it, parent pays", async ({
  browser,
}, testInfo) => {
  const title = uniqueTitle("E2E job", testInfo.workerIndex);

  const parent = await browser.newContext({
    storageState: SEEDED.parent.storageState,
  });
  const kid = await browser.newContext({
    storageState: SEEDED.kid.storageState,
  });
  const parentPage = await parent.newPage();
  const kidPage = await kid.newPage();

  try {
    // --- Parent posts the job --------------------------------------------
    await parentPage.goto("/jobs");
    await parentPage.getByRole("button", { name: "+ Post a job" }).click();
    await parentPage.getByPlaceholder("e.g., Mow the lawn").fill(title);
    await parentPage.getByRole("button", { name: "Post", exact: true }).click();
    await expect(card(parentPage, title).getByText("Open")).toBeVisible();

    // --- Kid takes it, then marks it done --------------------------------
    await kidPage.goto("/jobs");
    const kidJob = card(kidPage, title);
    await expect(kidJob).toBeVisible();
    await kidJob.getByRole("button", { name: /take it/i }).click();
    await kidJob.getByRole("button", { name: "✓ Mark done" }).click();
    await expect(kidJob.getByText("Done — awaiting payment")).toBeVisible();

    // --- Parent verifies & pays ------------------------------------------
    await parentPage.reload();
    const parentJob = card(parentPage, title);
    await parentJob.getByRole("button", { name: "💰 Verify & pay" }).click();
    await expect(card(parentPage, title).getByText("Paid")).toBeVisible();
  } finally {
    await parent.close();
    await kid.close();
  }
});
