import { test } from "@playwright/test";
import { DEFAULT_REPOSITORIES, gotoApp } from "./fixtures/mock-tauri";

const REPO_C = {
  id: "repo-c",
  name: "gamma-tool",
  path: "/workspace/gamma-tool",
  currentBranch: "main",
  branches: [
    {
      name: "main",
      isMain: true,
      isCurrent: true,
      path: "/workspace/gamma-tool",
      commitCount: 3,
    },
  ],
  providerId: null,
  projectFile: null,
  publishConfig: { profiles: [], bindings: [], appliedBundles: [], drafts: [] },
};

test("probe edit dialog project file state (repo without binding)", async ({
  page,
}) => {
  await gotoApp(page, {
    repositories: [...DEFAULT_REPOSITORIES, REPO_C],
  });
  await page.getByRole("button", { name: "更多操作: gamma-tool" }).click();
  await page.getByRole("menuitem", { name: "编辑仓库" }).click();
  await page.waitForTimeout(100);
  let elapsed = 100;
  for (const step of [200, 300, 300, 500, 500, 500]) {
    const pf = await page
      .locator("#repo-edit-project-file")
      .innerText()
      .catch(() => "<none>");
    const saveDisabled =
      (await page
        .getByRole("button", { name: "保存" })
        .getAttribute("disabled")
        .catch(() => null)) !== null;
    const err = await page
      .getByText("先选择一个 Project File")
      .isVisible()
      .catch(() => false);
    console.log(
      `PROBE t=${elapsed}: pf=[${pf.trim()}] saveDisabled=${saveDisabled} err=${err}`
    );
    await page.waitForTimeout(step);
    elapsed += step;
  }
});
