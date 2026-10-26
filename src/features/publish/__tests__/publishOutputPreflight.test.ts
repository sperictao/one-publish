import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublishOutputPreflightResult } from "@/features/publish/publishRuntime";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

vi.mock("@/features/publish/publishRuntime", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/features/publish/publishRuntime")>();
  return {
    ...original,
    preflightProviderPublishOutput: vi.fn(),
  };
});

import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  buildProtectedOutputAccessDescription,
  buildPublishOutputValidationDescription,
  buildPublishOutputValidationTitle,
  requestPreparedOutputDirectoryAccess,
  requestProtectedOutputAccess,
} from "@/features/publish/publishOutputPreflight";
import { preflightProviderPublishOutput } from "@/features/publish/publishRuntime";

const openMock = vi.mocked(openDialog);
const preflightMock = vi.mocked(preflightProviderPublishOutput);

function preflightResult(
  overrides: Partial<PublishOutputPreflightResult> = {}
): PublishOutputPreflightResult {
  return {
    outputDir: "/out",
    configuredOutputDir: null,
    validation: { status: "compatible", issue: null },
    access: {
      status: "denied",
      protectedLocation: "documents",
      protectedRoot: "/Users/me/Documents",
      probeDirectory: "/Users/me/Documents/out",
      detail: null,
    },
    ...overrides,
  };
}

const SPEC = {
  version: 1,
  provider_id: "dotnet",
  project_path: "/repo/app",
  parameters: {},
};

beforeEach(() => {
  openMock.mockReset();
  preflightMock.mockReset();
});

describe("buildProtectedOutputAccessDescription", () => {
  it("substitutes the location label and probe directory", () => {
    const description = buildProtectedOutputAccessDescription(
      preflightResult(),
      {}
    );

    expect(description).toContain("文稿");
    expect(description).toContain("/Users/me/Documents/out");
  });

  it("maps desktop/downloads to their labels", () => {
    const result = preflightResult();
    result.access.protectedLocation = "desktop";
    expect(buildProtectedOutputAccessDescription(result, {})).toContain("桌面");

    result.access.protectedLocation = "downloads";
    expect(buildProtectedOutputAccessDescription(result, {})).toContain("下载");
  });

  it("falls back to outputDir/protectedRoot when probeDirectory is missing", () => {
    const result = preflightResult();
    result.access.probeDirectory = null;
    result.outputDir = "/fallback/out";
    expect(buildProtectedOutputAccessDescription(result, {})).toContain(
      "/fallback/out"
    );

    result.outputDir = "";
    result.access.protectedRoot = "/protected/root";
    expect(buildProtectedOutputAccessDescription(result, {})).toContain(
      "/protected/root"
    );
  });

  it("uses the translated template when provided", () => {
    const description = buildProtectedOutputAccessDescription(
      preflightResult(),
      {
        publishProtectedDirectoryAccessDeniedDesc:
          "Access denied at {{location}}: {{path}}",
        macOsProtectedDocuments: "Documents",
      }
    );

    expect(description).toBe(
      "Access denied at Documents: /Users/me/Documents/out"
    );
  });
});

describe("buildPublishOutputValidationTitle", () => {
  it("uses the invalid-path title for windows_drive_root_missing", () => {
    const result = preflightResult({
      validation: {
        status: "incompatible",
        issue: "windows_drive_root_missing",
      },
    });
    expect(buildPublishOutputValidationTitle(result, {})).toBe("发布目录无效");
  });

  it("uses the incompatible title for style mismatches", () => {
    const result = preflightResult({
      validation: {
        status: "incompatible",
        issue: "windows_style_path_on_posix",
      },
    });
    expect(buildPublishOutputValidationTitle(result, {})).toBe(
      "发布目录路径与当前系统不兼容"
    );
  });
});

describe("buildPublishOutputValidationDescription", () => {
  it("prefers configuredOutputDir then outputDir for the path", () => {
    const result = preflightResult({
      configuredOutputDir: "  C:\\publish  ",
      validation: {
        status: "incompatible",
        issue: "windows_style_path_on_posix",
      },
    });
    expect(buildPublishOutputValidationDescription(result, {})).toContain(
      "C:\\publish"
    );

    result.configuredOutputDir = "   ";
    result.outputDir = "/posix/out";
    expect(buildPublishOutputValidationDescription(result, {})).toContain(
      "/posix/out"
    );
  });

  it("renders per-issue descriptions", () => {
    const result = preflightResult({ outputDir: "C:\\out" });

    result.validation = {
      status: "incompatible",
      issue: "windows_style_path_on_posix",
    };
    expect(buildPublishOutputValidationDescription(result, {})).toContain(
      "Windows 风格路径"
    );

    result.validation = {
      status: "incompatible",
      issue: "posix_absolute_path_on_windows",
    };
    expect(buildPublishOutputValidationDescription(result, {})).toContain(
      "Unix 风格绝对路径"
    );

    result.validation = {
      status: "incompatible",
      issue: "windows_drive_root_missing",
    };
    expect(buildPublishOutputValidationDescription(result, {})).toContain(
      "Windows 盘符"
    );
  });

  it("falls back to the generic description for other issues", () => {
    const result = preflightResult({
      outputDir: "/out",
      validation: { status: "incompatible", issue: null },
    });
    expect(buildPublishOutputValidationDescription(result, {})).toContain(
      "路径与当前系统不兼容"
    );
  });
});

describe("requestProtectedOutputAccess", () => {
  it("returns null selection without re-preflighting when the dialog is dismissed", async () => {
    openMock.mockResolvedValue(null);
    const result = preflightResult();

    const request = await requestProtectedOutputAccess(SPEC, result, {});

    expect(request).toEqual({ preflight: result, selectedDirectory: null });
    expect(preflightMock).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: true,
        defaultPath: "/Users/me/Documents/out",
      })
    );
  });

  it("re-runs preflight after the user picks a directory", async () => {
    openMock.mockResolvedValue("/Users/me/Documents/out");
    const result = preflightResult();
    const updated = preflightResult({ outputDir: "/new" });
    preflightMock.mockResolvedValue(updated);

    const request = await requestProtectedOutputAccess(SPEC, result, {});

    expect(preflightMock).toHaveBeenCalledWith(SPEC);
    expect(request.preflight).toBe(updated);
    expect(request.selectedDirectory).toBe("/Users/me/Documents/out");
  });
});

describe("requestPreparedOutputDirectoryAccess", () => {
  it("resolves true only for a non-empty selection", async () => {
    const summary = {
      outputDir: "/out",
      accessStatus: "denied" as const,
      probeDirectory: "/p",
    };

    openMock.mockResolvedValue("/picked");
    await expect(
      requestPreparedOutputDirectoryAccess(summary, {})
    ).resolves.toBe(true);

    openMock.mockResolvedValue("");
    await expect(
      requestPreparedOutputDirectoryAccess(summary, {})
    ).resolves.toBe(false);
  });
});
