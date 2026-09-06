import { expect, test } from "@playwright/test";
import { gotoApp, gotoAppWithPublishConfig } from "../fixtures/mock-tauri";

test("命令导入入口可达，解析参数进入新配置草稿", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args: Record<string, unknown>
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command, args) => {
      if (command === "import_from_command") {
        return {
          providerId: args.providerId,
          parameters: { configuration: "Debug" },
          diagnostics: [],
        };
      }
      return invoke(command, args);
    };
  });
  await page.getByRole("button", { name: "从命令创建配置" }).click();
  await page.getByLabel("构建命令").fill("dotnet publish -c Debug");
  await page.getByRole("button", { name: "解析命令" }).click();
  await expect(page.getByText("提取的参数")).toBeVisible();
  await page.getByRole("button", { name: "导入参数", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "创建发布配置" })
  ).toBeVisible();
  await expect(page.getByLabel("配置名称")).toHaveValue("");
  await expect(
    page.getByRole("textbox", { name: "configuration", exact: true })
  ).toHaveValue("Debug");
});

test("发布成功后可打包、签名、打开清单，新发布清空旧产物结果", async ({
  page,
}) => {
  await gotoAppWithPublishConfig(page);
  await page.evaluate(() => {
    const internals = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (
            command: string,
            args: Record<string, unknown>
          ) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = internals.invoke;
    internals.invoke = async (command, args) =>
      command === "plugin:dialog|save"
        ? "/tmp/artifact.zip"
        : invoke(command, args);
  });
  await page.getByTestId("publish-execute-btn").click();
  await expect(page.getByTestId("publish-status-panel")).toContainText("成功");
  await expect(page.getByRole("button", { name: "签名 (GPG)" })).toBeDisabled();
  await page.getByRole("button", { name: "打包 ZIP" }).click();
  await expect(page.getByRole("button", { name: "签名 (GPG)" })).toBeEnabled();
  await page.getByRole("button", { name: "签名 (GPG)" }).click();
  await expect(
    page.getByText("/tmp/artifact.zip.sig", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "发布清单", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "签名发布清单" })
  ).toBeVisible();
  await page.getByRole("button", { name: /签名校验/ }).click();
  await expect(
    page.getByRole("dialog").getByText("/tmp/artifact.zip.sig", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "重新发布", exact: true }).click();
  await expect(page.getByTestId("publish-status-panel")).toContainText("成功");
  await expect(page.getByRole("button", { name: "签名 (GPG)" })).toBeDisabled();
  await expect(
    page.getByText("/tmp/artifact.zip.sig", { exact: true })
  ).toHaveCount(0);
});
