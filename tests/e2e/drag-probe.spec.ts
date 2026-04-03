import { test, expect } from "@playwright/test";

test("probe drag events from draggable button", async ({ page }) => {
  await page.setContent(`
    <!doctype html>
    <html>
      <body>
        <button id="btn" draggable="true" style="width:120px;height:40px;">drag me</button>
        <div id="target" style="margin-top:20px;width:200px;height:80px;border:1px solid red;"></div>
        <script>
          window.__events = [];
          const btn = document.getElementById('btn');
          const target = document.getElementById('target');
          btn.addEventListener('dragstart', () => window.__events.push('dragstart'));
          target.addEventListener('dragenter', (event) => {
            event.preventDefault();
            window.__events.push('dragenter');
          });
          target.addEventListener('dragover', (event) => {
            event.preventDefault();
            window.__events.push('dragover');
          });
          target.addEventListener('drop', (event) => {
            event.preventDefault();
            window.__events.push('drop');
          });
        </script>
      </body>
    </html>
  `);

  await page.locator("#btn").dragTo(page.locator("#target"));
  const events = await page.evaluate(() => (window as typeof window & { __events: string[] }).__events);
  console.log(JSON.stringify(events));
  expect(events.length).toBeGreaterThan(0);
});
