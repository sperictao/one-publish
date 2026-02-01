import { test, expect } from '@playwright/test';

test('smoke: renderer serves app entrypoint', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // App entry HTML exists
  await expect(page.locator('#root')).toHaveCount(1);

  // App entry script is reachable (stronger than "body has some text",
  // avoids coupling to UI copy and avoids needing React to fully mount).
  const res = await page.request.get('/main.tsx');
  expect(res.ok()).toBeTruthy();
});
