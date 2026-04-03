import { expect, test, type Page } from "@playwright/test";

type MockProfile = {
  name: string;
  providerId: string;
  parameters: Record<string, unknown>;
  profileGroup?: string | null;
  createdAt: string;
  isSystemDefault: boolean;
};

function createMockAppState() {
  return {
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
          selectedPreset: "release-fd",
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
          selectedPreset: "release-fd",
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
        currentBranch: "feature/drag",
        branches: [],
        providerId: "dotnet",
        projectFile: "/workspace/charlie-api/App.csproj",
        isMain: false,
        publishConfig: {
          selectedPreset: "release-fd",
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
    middlePanelWidth: 280,
    panelWidthsCustomized: false,
    minimizeToTrayOnClose: true,
    language: "zh",
    defaultOutputDir: "",
    theme: "auto",
    executionHistoryLimit: 20,
    environmentProviderIds: ["dotnet"],
    recentRepoIds: ["repo-a"],
    recentConfigKeysByRepo: {
      "repo-a": ["userprofile:alpha-profile", "userprofile:beta-profile"],
    },
    startupNotice: null,
    executionHistory: [],
  };
}

function createMockProfilesByRepo(): Record<string, MockProfile[]> {
  return {
    "repo-a": [
      {
        name: "alpha-profile",
        providerId: "dotnet",
        parameters: {},
        profileGroup: "Group A",
        createdAt: "2026-04-03T00:00:00.000Z",
        isSystemDefault: false,
      },
      {
        name: "beta-profile",
        providerId: "dotnet",
        parameters: {},
        profileGroup: "Group B",
        createdAt: "2026-04-03T00:00:00.000Z",
        isSystemDefault: false,
      },
      {
        name: "gamma-profile",
        providerId: "dotnet",
        parameters: {},
        profileGroup: "Group B",
        createdAt: "2026-04-03T00:00:00.000Z",
        isSystemDefault: false,
      },
    ],
  };
}

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
            selectedPreset: "release-fd",
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
            selectedPreset: "release-fd",
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
          currentBranch: "feature/drag",
          branches: [],
          providerId: "dotnet",
          projectFile: "/workspace/charlie-api/App.csproj",
          isMain: false,
          publishConfig: {
            selectedPreset: "release-fd",
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
      middlePanelWidth: 280,
      panelWidthsCustomized: false,
      minimizeToTrayOnClose: true,
      language: "zh",
      defaultOutputDir: "",
      theme: "auto",
      executionHistoryLimit: 20,
      environmentProviderIds: ["dotnet"],
      recentRepoIds: ["repo-a"],
      recentConfigKeysByRepo: {
        "repo-a": ["userprofile:alpha-profile", "userprofile:beta-profile"],
      },
      startupNotice: null,
      executionHistory: [],
    };
    const profilesByRepo: Record<string, MockProfile[]> = {
      "repo-a": [
        {
          name: "alpha-profile",
          providerId: "dotnet",
          parameters: {},
          profileGroup: "Group A",
          createdAt: "2026-04-03T00:00:00.000Z",
          isSystemDefault: false,
        },
        {
          name: "beta-profile",
          providerId: "dotnet",
          parameters: {},
          profileGroup: "Group B",
          createdAt: "2026-04-03T00:00:00.000Z",
          isSystemDefault: false,
        },
        {
          name: "gamma-profile",
          providerId: "dotnet",
          parameters: {},
          profileGroup: "Group B",
          createdAt: "2026-04-03T00:00:00.000Z",
          isSystemDefault: false,
        },
      ],
    };
    const commandLog: Array<{ cmd: string; args: unknown }> = [];

    const dotnetSchema = {
      parameters: {
        configuration: {
          type: "string",
          flag: "--configuration",
        },
        runtime: {
          type: "string",
          flag: "--runtime",
        },
        output: {
          type: "string",
          flag: "--output",
        },
        self_contained: {
          type: "boolean",
          flag: "--self-contained",
        },
        framework: {
          type: "string",
          flag: "--framework",
        },
        no_build: {
          type: "boolean",
          flag: "--no-build",
        },
        properties: {
          type: "map",
          flag: "",
          prefix: "-p:",
        },
        define: {
          type: "array",
          flag: "--define",
        },
      },
    };

    function reorderByName(
      items: MockProfile[],
      orderedProfiles: Array<{ name: string; profileGroup?: string | null }>
    ) {
      const lookup = new Map(items.map((item) => [item.name, item]));
      return orderedProfiles
        .map((entry) => {
          const profile = lookup.get(entry.name);
          if (!profile) {
            return null;
          }

          return {
            ...profile,
            profileGroup: entry.profileGroup ?? null,
          };
        })
        .filter((profile): profile is MockProfile => profile !== null);
    }

    globalThis.isTauri = false;
    (globalThis as typeof globalThis & {
      __TAURI_INTERNALS__: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      __ONE_PUBLISH_E2E_MOCK__: {
        appState: typeof appState;
        profilesByRepo: typeof profilesByRepo;
        commandLog: typeof commandLog;
      };
    }).__ONE_PUBLISH_E2E_MOCK__ = {
      appState,
      profilesByRepo,
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
          case "resolve_project_info":
            return {
              root_path: "/workspace/alpha-service",
              project_file: "/workspace/alpha-service/App.csproj",
              publish_profiles: ["FolderProfile", "ZipProfile"],
              target_frameworks: ["net8.0"],
            };
          case "check_repository_branch_connectivity":
            return { canConnect: true, reason: null };
          case "reorder_repositories": {
            const repoIds = Array.isArray(args?.repoIds) ? args?.repoIds : [];
            const nextOrder = new Map(
              appState.repositories.map((repo) => [repo.id, repo])
            );
            appState.repositories = repoIds
              .map((repoId) => nextOrder.get(String(repoId)))
              .filter((repo): repo is (typeof appState.repositories)[number] => Boolean(repo));
            return clone(appState);
          }
          case "reorder_recent_publish_configs": {
            const repoId = String(args?.repoId ?? "");
            const configKeys = Array.isArray(args?.configKeys)
              ? args?.configKeys.map((item) => String(item))
              : [];
            appState.recentConfigKeysByRepo[repoId] = configKeys;
            return clone(appState);
          }
          case "reorder_profiles": {
            const repoId = String(args?.repoId ?? "");
            const orderedProfiles = Array.isArray(args?.profiles)
              ? (args?.profiles as Array<{ name: string; profileGroup?: string | null }>)
              : [];
            profilesByRepo[repoId] = reorderByName(
              profilesByRepo[repoId] ?? [],
              orderedProfiles
            );
            return clone(appState);
          }
          case "update_ui_state":
          case "update_publish_state":
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
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await installMockTauri(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-list-item-id='repo-a']")).toBeVisible();
  expect(pageErrors).toEqual([]);
}

async function dragByHandle(
  page: Page,
  rowSelector: string,
  moves: Array<{ x: number; y: number }>
) {
  const handle = page.locator(`${rowSelector} button[aria-label='拖动排序']`);
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    throw new Error(`missing handle box for ${rowSelector}`);
  }

  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2
  );
  await page.mouse.down();

  for (const move of moves) {
    await page.mouse.move(move.x, move.y);
    await page.waitForTimeout(80);
  }
}

async function getBubbleThresholdPointerY(
  page: Page,
  sourceRowSelector: string,
  targetRowSelector: string
) {
  const sourceRowBox = await page.locator(sourceRowSelector).boundingBox();
  const targetRowBox = await page.locator(targetRowSelector).boundingBox();
  const handleBox = await page
    .locator(`${sourceRowSelector} button[aria-label='拖动排序']`)
    .boundingBox();

  if (!sourceRowBox || !targetRowBox || !handleBox) {
    throw new Error(`missing drag geometry for ${sourceRowSelector}`);
  }

  const handleCenterY = handleBox.y + handleBox.height / 2;
  const anchorOffsetY = handleCenterY - sourceRowBox.y;
  const draggedCenterOffsetY = sourceRowBox.height / 2 - anchorOffsetY;
  const targetMidpointY = targetRowBox.y + targetRowBox.height / 2;

  return targetMidpointY - draggedCenterOffsetY;
}

async function expectDraggedRowAlignedWithFloatingShell(
  page: Page,
  rowSelector: string
) {
  const alignment = await page.evaluate((selector) => {
    const row = document.querySelector<HTMLElement>(selector);
    if (!row) {
      return null;
    }

    const rowRect = row.getBoundingClientRect();
    const floatingCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".list-scroll-shell [aria-hidden='true'] .floating-list-card"
      )
    );

    const nearestCard = floatingCards
      .map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          distance:
            Math.abs(rect.top - rowRect.top) + Math.abs(rect.left - rowRect.left),
        };
      })
      .sort((left, right) => left.distance - right.distance)[0];

    if (!nearestCard) {
      return null;
    }

    return {
      topDelta: Math.abs(nearestCard.top - rowRect.top),
      leftDelta: Math.abs(nearestCard.left - rowRect.left),
      widthDelta: Math.abs(nearestCard.width - rowRect.width),
      heightDelta: Math.abs(nearestCard.height - rowRect.height),
    };
  }, rowSelector);

  expect(alignment).not.toBeNull();
  expect(alignment?.topDelta ?? 99).toBeLessThan(2);
  expect(alignment?.leftDelta ?? 99).toBeLessThan(2);
  expect(alignment?.widthDelta ?? 99).toBeLessThan(2);
  expect(alignment?.heightDelta ?? 99).toBeLessThan(2);
}

async function measureDraggedRowAndFloatingShell(
  page: Page,
  rowSelector: string
) {
  return page.evaluate((selector) => {
    const row = document.querySelector<HTMLElement>(selector);
    if (!row) {
      return null;
    }

    const rowRect = row.getBoundingClientRect();
    const floatingCards = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".list-scroll-shell [aria-hidden='true'] .floating-list-card"
      )
    );

    const nearestCard = floatingCards
      .map((card) => {
        const rect = card.getBoundingClientRect();
        return {
          top: rect.top,
          left: rect.left,
          distance:
            Math.abs(rect.top - rowRect.top) + Math.abs(rect.left - rowRect.left),
        };
      })
      .sort((left, right) => left.distance - right.distance)[0];

    if (!nearestCard) {
      return null;
    }

    return {
      rowTop: rowRect.top,
      floatingTop: nearestCard.top,
    };
  }, rowSelector);
}

async function expectDraggedRowFollowsPointer(
  page: Page,
  rowSelector: string,
  moveTo: { x: number; y: number },
  direction: "up" | "down"
) {
  const beforeMove = await measureDraggedRowAndFloatingShell(page, rowSelector);
  expect(beforeMove).not.toBeNull();

  await page.mouse.move(moveTo.x, moveTo.y);
  await page.waitForTimeout(120);

  const afterMove = await measureDraggedRowAndFloatingShell(page, rowSelector);
  expect(afterMove).not.toBeNull();

  const rowDelta = (afterMove?.rowTop ?? 0) - (beforeMove?.rowTop ?? 0);
  const floatingDelta =
    (afterMove?.floatingTop ?? 0) - (beforeMove?.floatingTop ?? 0);

  if (direction === "up") {
    expect(rowDelta).toBeLessThan(-8);
    expect(floatingDelta).toBeLessThan(-8);
    return;
  }

  expect(rowDelta).toBeGreaterThan(8);
  expect(floatingDelta).toBeGreaterThan(8);
}

test("live preview drag bubble feels correct across repository and config lists", async ({
  page,
}, testInfo) => {
  await gotoApp(page);

  const repoOrder = page.locator(".repo-list-grid [data-list-item-id]");
  await expect(repoOrder).toHaveCount(3);

  const repoThresholdY = await getBubbleThresholdPointerY(
    page,
    "[data-list-item-id='repo-c']",
    "[data-list-item-id='repo-b']"
  );
  const repoHandleBox = await page
    .locator("[data-list-item-id='repo-c'] button[aria-label='拖动排序']")
    .boundingBox();
  if (!repoHandleBox) {
    throw new Error("missing repo-c drag handle");
  }

  await dragByHandle(page, "[data-list-item-id='repo-c']", [
    {
      x: repoHandleBox.x + repoHandleBox.width / 2 + 12,
      y: repoThresholdY + 8,
    },
  ]);

  await expect(repoOrder.nth(0)).toHaveAttribute("data-list-item-id", "repo-a");
  await expect(repoOrder.nth(1)).toHaveAttribute("data-list-item-id", "repo-b");
  await expect(repoOrder.nth(2)).toHaveAttribute("data-list-item-id", "repo-c");

  await page.mouse.move(
    repoHandleBox.x + repoHandleBox.width / 2 + 12,
    repoThresholdY - 8
  );
  await page.waitForTimeout(120);

  await expect(repoOrder.nth(0)).toHaveAttribute("data-list-item-id", "repo-a");
  await expect(repoOrder.nth(1)).toHaveAttribute("data-list-item-id", "repo-c");
  await expect(repoOrder.nth(2)).toHaveAttribute("data-list-item-id", "repo-b");
  await expectDraggedRowAlignedWithFloatingShell(
    page,
    "[data-list-item-id='repo-c']"
  );
  await expectDraggedRowFollowsPointer(
    page,
    "[data-list-item-id='repo-c']",
    {
      x: repoHandleBox.x + repoHandleBox.width / 2 + 12,
      y: repoThresholdY - 28,
    },
    "up"
  );

  await page.screenshot({
    path: testInfo.outputPath("repo-live-bubble.png"),
    fullPage: true,
  });

  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __ONE_PUBLISH_E2E_MOCK__: {
                commandLog: Array<{ cmd: string; args: { repoIds?: string[] } }>;
              };
            }
          ).__ONE_PUBLISH_E2E_MOCK__.commandLog
            .filter((entry) => entry.cmd === "reorder_repositories")
            .map((entry) => entry.args.repoIds ?? [])
      )
    )
    .toContainEqual(["repo-a", "repo-c", "repo-b"]);

  const recentOrder = page.locator(
    "[data-list-item-id^='recent:']"
  );
  const recentThresholdY = await getBubbleThresholdPointerY(
    page,
    "[data-list-item-id='recent:userprofile:beta-profile']",
    "[data-list-item-id='recent:userprofile:alpha-profile']"
  );
  const recentHandleBox = await page
    .locator(
      "[data-list-item-id='recent:userprofile:beta-profile'] button[aria-label='拖动排序']"
    )
    .boundingBox();
  if (!recentHandleBox) {
    throw new Error("missing recent beta handle");
  }

  await dragByHandle(page, "[data-list-item-id='recent:userprofile:beta-profile']", [
    {
      x: recentHandleBox.x + recentHandleBox.width / 2 + 12,
      y: recentThresholdY + 8,
    },
  ]);

  await expect(recentOrder.nth(0)).toHaveAttribute(
    "data-list-item-id",
    "recent:userprofile:alpha-profile"
  );
  await expect(recentOrder.nth(1)).toHaveAttribute(
    "data-list-item-id",
    "recent:userprofile:beta-profile"
  );

  await page.mouse.move(
    recentHandleBox.x + recentHandleBox.width / 2 + 12,
    recentThresholdY - 8
  );
  await page.waitForTimeout(120);

  await expect(recentOrder.nth(0)).toHaveAttribute(
    "data-list-item-id",
    "recent:userprofile:beta-profile"
  );
  await expect(recentOrder.nth(1)).toHaveAttribute(
    "data-list-item-id",
    "recent:userprofile:alpha-profile"
  );
  await page.mouse.up();

  const projectOrder = page.locator("[data-list-item-id^='pubxml:']");
  const projectThresholdY = await getBubbleThresholdPointerY(
    page,
    "[data-list-item-id='pubxml:ZipProfile']",
    "[data-list-item-id='pubxml:FolderProfile']"
  );
  const projectHandleBox = await page
    .locator("[data-list-item-id='pubxml:ZipProfile'] button[aria-label='拖动排序']")
    .boundingBox();
  if (!projectHandleBox) {
    throw new Error("missing project ZipProfile handle");
  }

  await dragByHandle(page, "[data-list-item-id='pubxml:ZipProfile']", [
    {
      x: projectHandleBox.x + projectHandleBox.width / 2 + 12,
      y: projectThresholdY + 8,
    },
  ]);

  await expect(projectOrder.nth(0)).toHaveAttribute(
    "data-list-item-id",
    "pubxml:FolderProfile"
  );
  await expect(projectOrder.nth(1)).toHaveAttribute(
    "data-list-item-id",
    "pubxml:ZipProfile"
  );

  await page.mouse.move(
    projectHandleBox.x + projectHandleBox.width / 2 + 12,
    projectThresholdY - 8
  );
  await page.waitForTimeout(120);

  await expect(projectOrder.nth(0)).toHaveAttribute(
    "data-list-item-id",
    "pubxml:ZipProfile"
  );
  await expect(projectOrder.nth(1)).toHaveAttribute(
    "data-list-item-id",
    "pubxml:FolderProfile"
  );
  await page.mouse.up();

  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("one-publish:projectPublishProfileOrder")
      )
    )
    .toContain("ZipProfile");

  const customOrder = page.locator("[data-list-item-id^='userprofile:']");
  const customThresholdY = await getBubbleThresholdPointerY(
    page,
    "[data-list-item-id='userprofile:alpha-profile']",
    "[data-list-item-id='userprofile:beta-profile']"
  );
  const customHandleBox = await page
    .locator(
      "[data-list-item-id='userprofile:alpha-profile'] button[aria-label='拖动排序']"
    )
    .boundingBox();
  if (!customHandleBox) {
    throw new Error("missing custom alpha handle");
  }

  await dragByHandle(page, "[data-list-item-id='userprofile:alpha-profile']", [
    {
      x: customHandleBox.x + customHandleBox.width / 2 + 12,
      y: customThresholdY - 8,
    },
  ]);

  await expect(customOrder.nth(0)).toHaveAttribute(
    "data-list-item-id",
    "userprofile:alpha-profile"
  );

  await page.mouse.move(
    customHandleBox.x + customHandleBox.width / 2 + 12,
    customThresholdY + 8
  );
  await page.waitForTimeout(120);

  await expect(customOrder.nth(0)).toHaveAttribute(
    "data-list-item-id",
    "userprofile:beta-profile"
  );
  await expect(customOrder.nth(1)).toHaveAttribute(
    "data-list-item-id",
    "userprofile:alpha-profile"
  );
  await expect(customOrder.nth(2)).toHaveAttribute(
    "data-list-item-id",
    "userprofile:gamma-profile"
  );
  await expectDraggedRowAlignedWithFloatingShell(
    page,
    "[data-list-item-id='userprofile:alpha-profile']"
  );
  await expectDraggedRowFollowsPointer(
    page,
    "[data-list-item-id='userprofile:alpha-profile']",
    {
      x: customHandleBox.x + customHandleBox.width / 2 + 12,
      y: customThresholdY + 28,
    },
    "down"
  );

  await page.screenshot({
    path: testInfo.outputPath("custom-group-live-bubble.png"),
    fullPage: true,
  });

  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __ONE_PUBLISH_E2E_MOCK__: {
                profilesByRepo: Record<
                  string,
                  Array<{ name: string; profileGroup?: string | null }>
                >;
              };
            }
          ).__ONE_PUBLISH_E2E_MOCK__.profilesByRepo["repo-a"].map((profile) => ({
            name: profile.name,
            profileGroup: profile.profileGroup ?? null,
          }))
      )
    )
    .toEqual([
      { name: "beta-profile", profileGroup: "Group B" },
      { name: "alpha-profile", profileGroup: "Group B" },
      { name: "gamma-profile", profileGroup: "Group B" },
    ]);
});
