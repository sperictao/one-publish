import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArtifactActions } from "@/components/publish/ArtifactActions";
import type { ArtifactActionState, PackageResult } from "@/lib/artifact";

const mocks = vi.hoisted(() => ({
  packageArtifact: vi.fn(),
  signArtifact: vi.fn(),
  save: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@/lib/artifact", () => ({
  packageArtifact: mocks.packageArtifact,
  signArtifact: mocks.signArtifact,
}));

// 用真实 zh 文案，顺带校验后端错误码已在 `errors.<code>` 登记。
vi.mock("@/hooks/useI18n", async () => {
  const zh = (await import("@/i18n/zh.json")).default;
  return { useI18n: () => ({ translations: zh }) };
});

const packageResult: PackageResult = {
  artifactPath: "/tmp/output.zip",
  format: "zip",
  sha256: "abc",
  fileCount: 3,
  bytes: 512,
};

// Tauri invoke 以 AppError 对象 reject，而不是 Error 实例。
function artifactError(code: string, message: string, details: string) {
  return { kind: "artifact", message, details, code };
}

function renderArtifactActions(state: ArtifactActionState) {
  render(
    <ArtifactActions
      outputDir="/tmp/output"
      state={state}
      onStateChange={vi.fn()}
    />
  );
}

describe("ArtifactActions 失败提示", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue("/tmp/output.zip");
  });

  it("打包失败时用错误码文案描述 AppError", async () => {
    mocks.packageArtifact.mockRejectedValue(
      artifactError(
        "artifact_package_failed",
        "package failed",
        "input directory does not exist: /tmp/output"
      )
    );
    renderArtifactActions({ packageResult: null, signResult: null });

    fireEvent.click(screen.getByRole("button", { name: "打包 ZIP" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("打包失败", {
        description:
          "无法打包产物 | input directory does not exist: /tmp/output",
      })
    );
  });

  it("签名失败时用错误码文案描述 AppError", async () => {
    mocks.signArtifact.mockRejectedValue(
      artifactError(
        "artifact_sign_failed",
        "sign failed",
        "signing command timed out"
      )
    );
    renderArtifactActions({ packageResult, signResult: null });

    fireEvent.click(screen.getByRole("button", { name: "签名 (GPG)" }));

    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("签名失败", {
        description: "无法签名产物 | signing command timed out",
      })
    );
  });
});
