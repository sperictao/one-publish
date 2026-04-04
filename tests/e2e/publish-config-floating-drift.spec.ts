import { expect, test, type Page } from "@playwright/test";

async function installMockTauri(page: Page) {
  await page.addInitScript(() => {
    const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

    const appState = {
      repositories: [
        {
          id: "repo-a",
          name: "alpha-service",
          path: "/workspace/alpha-service",
          currentBranch: "main",
          branches: [],
          providerId: "dotnet",
          projectFile: "/workspace/alpha-service/App.csproj",
          isMain: true,
          publishConfig: {
            selectedPreset: "profile-FolderProfile",
            isCustomMode: false,
            customConfig: {
              configuration: "Release",
              runtime: "",
              framework: "",
              selfContained: false,
              outputDir: "",
              noBuild: false,
              noRestore: false,
              verbosity: "",
              noLogo: false,
              properties: {},
              define: [],
              useProfile: false,
              profileName: "",
            },
            profiles: [],
          },
        },
        {
          id: "repo-b",
          name: "beta-worker",
          path: "/workspace/beta-worker",
          currentBranch: "release",
          branches: [],
          providerId: "dotnet",
          projectFile: "/workspace/beta-worker/App.csproj",
          isMain: false,
          publishConfig: {
            selectedPreset: "profile-FolderProfile",
            isCustomMode: false,
            customConfig: {
              configuration: "Release",
              runtime: "",
              framework: "",
              selfContained: false,
              outputDir: "",
              noBuild: false,
              noRestore: false,
              verbosity: "",
              noLogo: false,
              properties: {},
              define: [],
              useProfile: false,
              profileName: "",
            },
            profiles: [],
          },
        },
        {
          id: "repo-c",
          name: "charlie-api",
          path: "/workspace/charlie-api",
          currentBranch: "feature/floating-card",
          branches: [],
          providerId: "dotnet",
          projectFile: "/workspace/charlie-api/App.csproj",
          isMain: false,
          publishConfig: {
            selectedPreset: "profile-FolderProfile",
            isCustomMode: false,
            customConfig: {
              configuration: "Release",
              runtime: "",
              framework: "",
              selfContained: false,
              outputDir: "",
              noBuild: false,
              noRestore: false,
              verbosity: "",
              noLogo: false,
              properties: {},
              define: [],
              useProfile: false,
              profileName: "",
            },
            profiles: [],
          },
        },
      ],
      selectedRepoId: "repo-a",
      leftPanelWidth: 220,
      middlePanelWidth: 320,
      panelWidthsCustomized: false,
      minimizeToTrayOnClose: true,
      language: "zh",
      defaultOutputDir: "",
      theme: "auto",
      executionHistoryLimit: 20,
      environmentProviderIds: ["dotnet"],
      recentRepoIds: ["repo-a"],
      recentConfigKeysByRepo: {},
      startupNotice: null,
      executionHistory: [],
    };

    const profilesByRepo = {
      "repo-a": [],
      "repo-b": [],
      "repo-c": [],
    };

    const commandLog: Array<{ cmd: string; args: unknown }> = [];

    const dotnetSchema = {
      parameters: {
        configuration: {
          type: "string",
          flag: "--configuration",
        },
      },
    };

    globalThis.isTauri = false;
    (
      globalThis as typeof globalThis & {
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        };
        __ONE_PUBLISH_E2E_MOCK__: {
          appState: typeof appState;
          commandLog: typeof commandLog;
        };
      }
    ).__ONE_PUBLISH_E2E_MOCK__ = {
      appState,
      commandLog,
    };

    globalThis.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: Record<string, unknown>) => {
        commandLog.push({ cmd, args: clone(args ?? {}) });

        switch (cmd) {
          case "get_app_state":
            return clone(appState);
          case "list_providers":
            return [
              {
                id: "dotnet",
                display_name: "dotnet",
                version: "8.0.0",
              },
            ];
          case "get_provider_schema":
            return clone(dotnetSchema);
          case "get_profiles":
            return clone(profilesByRepo[String(args?.repoId ?? "")] ?? []);
          case "scan_project":
          case "resolve_project_info": {
            const projectFile = String(args?.projectFile ?? "");
            const repoPath = String(args?.repoPath ?? "");
            const rootPath =
              projectFile.replace(/\/App\.csproj$/, "") || repoPath || "/workspace/alpha-service";
            return {
              root_path: rootPath,
              project_file: `${rootPath}/App.csproj`,
              publish_profiles: ["FolderProfile", "ZipProfile", "WebDeploy"],
              target_frameworks: ["net8.0"],
            };
          }
          case "check_repository_branch_connectivity":
            return { canConnect: true, reason: null };
          case "update_publish_state": {
            const nextSelectedPreset = args?.selectedPreset;
            const nextCustomMode = args?.isCustomMode;
            const nextRepoId = appState.selectedRepoId;
            const repo = appState.repositories.find((item) => item.id === nextRepoId);
            if (repo) {
              if (typeof nextSelectedPreset === "string") {
                repo.publishConfig.selectedPreset = nextSelectedPreset;
              }
              if (typeof nextCustomMode === "boolean") {
                repo.publishConfig.isCustomMode = nextCustomMode;
              }
            }
            return null;
          }
          case "update_ui_state":
          case "update_preferences":
            return null;
          default:
            throw new Error(`Unhandled mock invoke command: ${cmd}`);
        }
      },
    };
  });
}

async function gotoApp(page: Page) {
  await installMockTauri(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
  await expect(page.locator("[data-list-item-id='pubxml:FolderProfile']")).toBeVisible();
}

async function measureSelectedRowDrift(page: Page) {
  return page.evaluate(() => {
    const selectedRow = document.querySelector<HTMLElement>(
      "[data-list-item-id='pubxml:FolderProfile']"
    );
    const listShell = selectedRow?.closest<HTMLElement>(".list-scroll-shell");
    const floatingSurface = listShell?.querySelector<HTMLElement>(
      "[aria-hidden='true'] .floating-list-card[data-selected='true']"
    );
    const floatingShell = floatingSurface?.parentElement?.parentElement as
      | HTMLElement
      | null;

    if (!selectedRow || !listShell || !floatingShell) {
      return null;
    }

    const rowRect = selectedRow.getBoundingClientRect();
    const shellRect = floatingShell.getBoundingClientRect();

    return {
      rowTop: rowRect.top,
      shellTop: shellRect.top,
      rowLeft: rowRect.left,
      shellLeft: shellRect.left,
      topDelta: shellRect.top - rowRect.top,
      leftDelta: shellRect.left - rowRect.left,
      transform: floatingShell.style.transform,
    };
  });
}

async function clickRepo(page: Page, repoId: string) {
  await page.click(`[data-list-item-id='${repoId}'] button[aria-pressed]`);
  await page.waitForTimeout(80);
}

test("middle publish config floating card stays aligned after repeated repo switching", async ({
  page,
}, testInfo) => {
  await gotoApp(page);

  const samples: Array<{ step: string; topDelta: number; leftDelta: number; transform: string }> =
    [];

  for (const repoId of ["repo-a", "repo-b", "repo-c", "repo-a", "repo-b", "repo-c"]) {
    await clickRepo(page, repoId);
    await page.waitForTimeout(700);
    const drift = await measureSelectedRowDrift(page);
    expect(drift).not.toBeNull();
    samples.push({
      step: repoId,
      topDelta: Number(drift?.topDelta.toFixed(3) ?? 0),
      leftDelta: Number(drift?.leftDelta.toFixed(3) ?? 0),
      transform: drift?.transform ?? "",
    });
  }

  await page.screenshot({
    path: testInfo.outputPath("publish-config-floating-drift.png"),
    fullPage: true,
  });

  expect(samples).toEqual([
    expect.objectContaining({
      step: "repo-a",
      topDelta: expect.any(Number),
      leftDelta: expect.any(Number),
    }),
    expect.objectContaining({
      step: "repo-b",
      topDelta: expect.any(Number),
      leftDelta: expect.any(Number),
    }),
    expect.objectContaining({
      step: "repo-c",
      topDelta: expect.any(Number),
      leftDelta: expect.any(Number),
    }),
    expect.objectContaining({
      step: "repo-a",
      topDelta: expect.any(Number),
      leftDelta: expect.any(Number),
    }),
    expect.objectContaining({
      step: "repo-b",
      topDelta: expect.any(Number),
      leftDelta: expect.any(Number),
    }),
    expect.objectContaining({
      step: "repo-c",
      topDelta: expect.any(Number),
      leftDelta: expect.any(Number),
    }),
  ]);

  for (const sample of samples) {
    expect(Math.abs(sample.topDelta)).toBeLessThan(2);
    expect(Math.abs(sample.leftDelta)).toBeLessThan(2);
  }
});
