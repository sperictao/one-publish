import { describe, expect, it } from "vitest";

import type { ExecutionRecord } from "@/lib/store/types";
import type { Repository } from "@/lib/store/types";
import { isRecordInRepository } from "@/features/history/utils/historyFilters";

function createRepository(path: string): Repository {
  return {
    id: "repo-1",
    name: "demo",
    path,
    currentBranch: "main",
    branches: [],
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
        deleteExistingFiles: false,
        properties: {},
        useProfile: false,
        profileName: "",
      },
      profiles: [],
    },
  };
}

function createRecord(projectPath: string): ExecutionRecord {
  return {
    id: "record-1",
    providerId: "dotnet",
    projectPath,
    startedAt: "2026-03-22T00:00:00.000Z",
    finishedAt: "2026-03-22T00:00:01.000Z",
    success: true,
    cancelled: false,
    fileCount: 1,
  };
}

describe("historyFilters path matching", () => {
  it("Linux 风格路径保留大小写敏感", () => {
    expect(
      isRecordInRepository(
        createRecord("/work/one-publish/src/App.csproj"),
        createRepository("/Work/one-publish")
      )
    ).toBe(false);
  });

  it("Windows 风格路径按不区分大小写匹配", () => {
    expect(
      isRecordInRepository(
        createRecord("c:/workspace/one-publish/src/App.csproj"),
        createRepository("C:\\Workspace\\One-Publish")
      )
    ).toBe(true);
  });
});
