import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublishRunCard } from "@/components/publish/PublishRunCard";
import type { ArtifactActionState } from "@/lib/artifact";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  isTauri: () => false,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.save }));
vi.mock("@/hooks/useI18n", () => ({ useI18n: () => ({ translations: {} }) }));

const packageResult = {
  artifactPath: "/tmp/output.zip",
  sha256: "abc",
  fileCount: 3,
  bytes: 512,
};
const signature = {
  artifactPath: "/tmp/output.zip",
  signaturePath: "/tmp/output.zip.sig",
  success: true,
  stdout: "",
  stderr: "",
  exitCode: 0,
};

function Harness({
  onChecklist,
  success = true,
}: {
  onChecklist: () => void;
  success?: boolean;
}) {
  const [state, setState] = useState<ArtifactActionState>({
    packageResult: null,
    signResult: null,
  });
  return (
    <PublishRunCard
      outputLog=""
      appT={{}}
      publishActions={null}
      publishResult={{
        provider_id: "cargo",
        success,
        cancelled: false,
        error: null,
        command: {
          program: "cargo",
          args: ["build"],
          working_dir: "/repo",
          display_command: "cargo build",
          env: [],
        },
        output_log: "",
        output_dir: "/tmp/output",
        file_count: 3,
        warnings: null,
      }}
      artifactActionState={state}
      onArtifactStateChange={setState}
      onOpenReleaseChecklist={onChecklist}
    />
  );
}

describe("PublishRunCard artifact actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.save.mockResolvedValue("/tmp/output.zip");
    mocks.invoke.mockImplementation(async (command) =>
      command === "package_artifact" ? packageResult : signature
    );
  });

  it("从发布结果卡调用打包和签名，重新打包后清除旧签名", async () => {
    const onChecklist = vi.fn();
    render(<Harness onChecklist={onChecklist} />);
    expect(screen.getByRole("button", { name: "签名 (GPG)" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "打包 ZIP" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "签名 (GPG)" })).toBeEnabled()
    );
    expect(mocks.invoke).toHaveBeenCalledWith("package_artifact", {
      inputDir: "/tmp/output",
      outputPath: "/tmp/output.zip",
      includeRootDir: true,
      format: "zip",
    });
    fireEvent.click(screen.getByRole("button", { name: "签名 (GPG)" }));
    await screen.findByText("/tmp/output.zip.sig");
    expect(mocks.invoke).toHaveBeenCalledWith("sign_artifact", {
      artifactPath: "/tmp/output.zip",
      method: "gpg_detached",
      outputPath: undefined,
      keyId: undefined,
    });
    fireEvent.click(screen.getByRole("button", { name: "发布清单" }));
    expect(onChecklist).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "打包 ZIP" }));
    await waitFor(() =>
      expect(screen.queryByText("/tmp/output.zip.sig")).toBeNull()
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "打包 ZIP" })).toBeEnabled()
    );
  });

  it("发布失败时不提供产物操作", () => {
    render(<Harness onChecklist={vi.fn()} success={false} />);
    expect(screen.queryByRole("button", { name: "打包 ZIP" })).toBeNull();
  });

  it("取消文件选择不调用后端也不丢失已有结果", async () => {
    mocks.save.mockResolvedValue(null);
    render(<Harness onChecklist={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "打包 ZIP" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "打包 ZIP" })).toBeEnabled()
    );
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
