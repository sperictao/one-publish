import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ReleaseSettingsEditorDialog } from "@/components/publish/ReleaseSettingsEditorDialog";
import type { TauriReleaseConfig } from "@/generated/tauri-contracts";
import { __setTranslationsCacheForTest } from "@/hooks/useI18n";
import zh from "@/i18n/zh.json";
import type { ConfigProfile } from "@/lib/store/types";

const {
  loadReleaseSettingsDraftMock,
  updateProfileReleaseSettingsMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  loadReleaseSettingsDraftMock: vi.fn(),
  updateProfileReleaseSettingsMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/lib/store/api", () => ({
  loadReleaseSettingsDraft: loadReleaseSettingsDraftMock,
  updateProfileReleaseSettings: updateProfileReleaseSettingsMock,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: vi.fn() },
}));

function suggestedSettings(): TauriReleaseConfig {
  return {
    appConfigPath: "src-tauri/tauri.conf.json",
    appName: "Demo",
    buildDriver: "pnpm",
    enabledTargets: [
      "windows_x64",
      "linux_x64",
      "macos_x64",
      "macos_arm64",
      "macos_universal",
    ],
    releaseAssetPatterns: ["*.dmg", "*.AppImage"],
    updater: {
      enabled: false,
      endpoint: null,
      publicKey: null,
      privateKeySecretName: null,
    },
    allowUnsignedRelease: false,
    requiredActionsSecretNames: [],
    actionsSecretEnvironment: {},
    tagPrefix: "v",
    releaseGates: [],
    localDeliveryDir: "dist/one-publish",
    versionMirrors: [],
    managedWorkflowVersion: 1,
  };
}

function createProfile(
  parameters: ConfigProfile["parameters"] = { configuration: "Release" }
): ConfigProfile {
  return {
    id: "configuration-1",
    revisionId: "revision-1",
    name: "Desktop Release",
    providerId: "tauri",
    parameters,
    projectBinding: "tauri:src-tauri/tauri.conf.json",
    profileGroup: null,
    createdAt: "2026-10-07T10:00:00Z",
    isSystemDefault: false,
    externalBindingIds: [],
    blockedReason: null,
  };
}

function renderDialog(profile = createProfile()) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    repoId: "repo-1",
    profile,
    onSaved: vi.fn(),
  };
  render(<ReleaseSettingsEditorDialog {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  __setTranslationsCacheForTest({ zh });
  updateProfileReleaseSettingsMock.mockResolvedValue({});
});

describe("ReleaseSettingsEditorDialog", () => {
  it("prefills suggested settings and saves the edited form as a new revision", async () => {
    loadReleaseSettingsDraftMock.mockResolvedValue({
      settings: suggestedSettings(),
      stored: false,
    });
    const props = renderDialog();

    await waitFor(() =>
      expect(loadReleaseSettingsDraftMock).toHaveBeenCalledWith({
        repoId: "repo-1",
        profileId: "configuration-1",
      })
    );
    // ADR-0060：未保存过的配置只预填建议值，保存前不写入修订。
    expect(
      await screen.findByTestId("release-settings-draft-notice")
    ).toHaveTextContent("保存后才会写入新修订");
    expect(screen.getByLabelText("配置文件路径")).toHaveValue(
      "src-tauri/tauri.conf.json"
    );

    fireEvent.change(screen.getByLabelText("标签前缀"), {
      target: { value: " app-v " },
    });
    fireEvent.click(screen.getByRole("switch", { name: "Windows x64" }));
    fireEvent.click(screen.getByRole("switch", { name: "授权未签名发布" }));
    fireEvent.click(screen.getByRole("button", { name: "添加门禁" }));
    fireEvent.change(screen.getByLabelText("程序 1"), {
      target: { value: "pnpm" },
    });
    fireEvent.change(screen.getByLabelText("参数（每行一个） 1"), {
      target: { value: "test\n\n--run" },
    });
    // 空白行由提交前整理丢弃，不交给后端判错。
    fireEvent.click(screen.getByRole("button", { name: "添加版本镜像" }));

    fireEvent.click(screen.getByTestId("release-settings-save"));

    await waitFor(() =>
      expect(updateProfileReleaseSettingsMock).toHaveBeenCalledWith({
        repoId: "repo-1",
        profileId: "configuration-1",
        settings: {
          ...suggestedSettings(),
          tagPrefix: "app-v",
          enabledTargets: [
            "linux_x64",
            "macos_x64",
            "macos_arm64",
            "macos_universal",
          ],
          allowUnsignedRelease: true,
          releaseGates: [{ program: "pnpm", args: ["test", "--run"] }],
        },
      })
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("发布设置已保存为新修订");
    expect(props.onSaved).toHaveBeenCalledTimes(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the form open and explains a rejected save", async () => {
    loadReleaseSettingsDraftMock.mockResolvedValue({
      settings: suggestedSettings(),
      stored: false,
    });
    updateProfileReleaseSettingsMock.mockRejectedValue({
      kind: "Validation",
      message:
        "platform signing environment-to-secret mappings are required unless unsigned releases are explicitly allowed",
      code: "tauri_release_platform_signing_required",
    });
    const props = renderDialog();

    fireEvent.click(await screen.findByTestId("release-settings-save"));

    // ADR-0006：默认值没有签名决定，后端校验在保存前显式拒绝。
    expect(
      await screen.findByTestId("release-settings-error")
    ).toHaveTextContent(zh.errors.tauri_release_platform_signing_required);
    expect(props.onSaved).not.toHaveBeenCalled();
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it("edits stored settings without the suggestion notice", async () => {
    loadReleaseSettingsDraftMock.mockResolvedValue({
      settings: {
        ...suggestedSettings(),
        updater: {
          enabled: true,
          endpoint: "https://updates.example.com/latest.json",
          publicKey: "public-key",
          privateKeySecretName: "TAURI_SIGNING_PRIVATE_KEY",
        },
      },
      stored: true,
    });
    renderDialog(createProfile({ releaseSettings: { tagPrefix: "v" } }));

    expect(await screen.findByLabelText("更新端点（HTTPS）")).toHaveValue(
      "https://updates.example.com/latest.json"
    );
    expect(screen.queryByTestId("release-settings-draft-notice")).toBeNull();

    fireEvent.change(screen.getByLabelText("私钥 Secret 名称"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByTestId("release-settings-save"));

    await waitFor(() =>
      expect(updateProfileReleaseSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            updater: {
              enabled: true,
              endpoint: "https://updates.example.com/latest.json",
              publicKey: "public-key",
              privateKeySecretName: null,
            },
          }),
        })
      )
    );
  });

  it("warns that unreadable stored settings will be replaced", async () => {
    loadReleaseSettingsDraftMock.mockResolvedValue({
      settings: suggestedSettings(),
      stored: false,
    });
    renderDialog(createProfile({ releaseSettings: { enabledTargets: "x" } }));

    expect(
      await screen.findByTestId("release-settings-draft-notice")
    ).toHaveTextContent("无法读取");
  });

  it("surfaces a failed draft load instead of an empty form", async () => {
    loadReleaseSettingsDraftMock.mockRejectedValue({
      kind: "Validation",
      message: "Provider dotnet 没有发布设置",
      code: "release_settings_provider_unsupported",
    });
    renderDialog();

    expect(
      await screen.findByText(
        `加载发布设置失败: ${zh.errors.release_settings_provider_unsupported}`
      )
    ).toBeInTheDocument();
    expect(screen.getByTestId("release-settings-save")).toBeDisabled();
  });
});
