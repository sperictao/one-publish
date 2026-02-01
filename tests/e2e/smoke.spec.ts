import { test, expect } from '@playwright/test';

test('smoke: can load app shell in renderer', async ({ page }) => {
  // This is a renderer-only smoke test. It does NOT boot the Tauri shell.
  // It expects `pnpm dev:renderer` to be running.

  const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173/';

  try {
    await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  } catch (err) {
    test.skip(
      true,
      `Renderer dev server not reachable at ${baseURL}. Start it with: pnpm dev:renderer`
    );
    throw err;
  }

  // Basic assertion: ensure the app root renders something.
  await expect(page.locator('body')).toContainText(/OnePublish|One Publish|Publish/i);
});
