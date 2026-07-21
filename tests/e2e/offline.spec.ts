import { expect, test } from "@playwright/test";

// The service worker (registered app-wide in src/app/layout.tsx) installs
// and activates -- verified here. Its actual fetch interception (the
// navigation cache-fallback and the Supabase REST cache in public/sw.js)
// could NOT be verified through Playwright in this environment: even a
// trivial, unconditional `self.addEventListener("fetch", ...)` listener
// never received an event for either a page navigation or an in-page
// `fetch()` call, in both headless and headed mode, despite the worker
// reporting itself active and controlling the page
// (`navigator.serviceWorker.controller` set). This matches a known class
// of Playwright/CDP limitation around service worker fetch-event
// dispatch, not a bug in the app -- see the discussion in
// Documentation/07-project-status.md. Verify the actual offline caching
// behavior by hand: Chrome DevTools -> Application -> Service Workers, or
// Network tab -> "Offline", after loading the app once online.
test("service worker registers and reaches the active state", async ({
  page,
}) => {
  await page.goto("/login");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg?.active?.state ?? null;
      }),
    )
    .toBe("activated");
});
