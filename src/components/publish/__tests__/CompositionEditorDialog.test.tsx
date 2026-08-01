import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CompositionEditorDialog } from "@/components/publish/CompositionEditorDialog";
import type { PublishComposition } from "@/generated/tauri-contracts";
import type { ConfigProfile } from "@/lib/store/types";

const { listPublishAdapterCatalogMock, toastErrorMock, toastSuccessMock } =
  vi.hoisted(() => ({
    listPublishAdapterCatalogMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
  }));

vi.mock("@/lib/store/api", () => ({
  listPublishAdapterCatalog: listPublishAdapterCatalogMock,
}));

vi.mock("sonner", () => ({
  toast: { success: toastSuccessMock, error: toastErrorMock },
}));

function localComposition(): PublishComposition {
  return {
    executionBackend: {
      adapterId: "local-execution",
      settingsVersion: 1,
      settings: {},
      credentials: {},
    },
    artifactStore: {
      adapterId: "temporary-artifact-store",
      settingsVersion: 1,
      settings: {},
      credentials: {},
    },
    artifactProcessors: [
      {
        adapterId: "checksum",
        settingsVersion: 1,
        settings: {},
        credentials: {},
      },
    ],
    deliveryRoutes: [
      {
        routeId: "local-delivery",
        required: true,
        destination: {
          adapterId: "local-directory",
          settingsVersion: 1,
          settings: {},
          credentials: {},
        },
      },
    ],
  };
}

function createProfile(composition: PublishComposition): ConfigProfile {
  return {
    id: "configuration-1",
    revisionId: "revision-1",
    name: "Desktop Release",
    providerId: "tauri",
    parameters: { configuration: "Release" },
    composition,
    projectBinding: "tauri:src-tauri/tauri.conf.json",
    profileGroup: null,
    createdAt: "2026-07-21T10:00:00Z",
    isSystemDefault: false,
    externalBindingIds: [],
    blockedReason: null,
  };
}

function renderDialog(overrides: { profile?: ConfigProfile } = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    profile: overrides.profile ?? createProfile(localComposition()),
    onSaveComposition: vi.fn().mockResolvedValue(undefined),
    onRebindProject: vi.fn().mockResolvedValue(undefined),
  };
  const view = render(<CompositionEditorDialog {...props} />);
  return { props, view };
}

beforeEach(() => {
  vi.clearAllMocks();
  listPublishAdapterCatalogMock.mockResolvedValue({
    executionBackends: ["local-execution"],
    artifactStores: ["temporary-artifact-store"],
    artifactProcessors: ["checksum"],
    deliveryDestinations: ["local-directory", "sftp", "github-release"],
  });
});

describe("CompositionEditorDialog", () => {
  it("renders the sealed composition sections and project binding", async () => {
    renderDialog();

    expect(
      await screen.findByText("tauri:src-tauri/tauri.conf.json")
    ).toBeInTheDocument();
    expect(screen.getByText("执行与存储")).toBeInTheDocument();
    expect(screen.getByText("产物处理（有序）")).toBeInTheDocument();
    expect(screen.getByText("交付路线（有序）")).toBeInTheDocument();
    expect(screen.getByText("1. checksum")).toBeInTheDocument();
    expect(screen.getByText("1. local-delivery")).toBeInTheDocument();
  });

  it("adds a delivery route from the catalog and expands it", async () => {
    renderDialog();

    fireEvent.click(await screen.findByTestId("composition-add-route"));

    // 新路线默认取目录里第一个 Destination，并展开显示无需配置的提示。
    await waitFor(() => {
      expect(
        screen.getByText("该目标没有需要配置的设置；本地目录由运行时派生。")
      ).toBeInTheDocument();
    });
  });

  it("rejects malformed credential references before saving", async () => {
    const composition = localComposition();
    composition.deliveryRoutes.push({
      routeId: "sftp-mirror",
      required: false,
      destination: {
        adapterId: "sftp",
        settingsVersion: 1,
        settings: { host: "mirror.example", remote_path: "/srv/releases" },
        credentials: { ssh_private_key: "raw secret value" },
      },
    });
    const { props } = renderDialog({ profile: createProfile(composition) });

    fireEvent.click(await screen.findByTestId("composition-save"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("sftp-mirror/ssh_private_key")
      );
    });
    expect(props.onSaveComposition).not.toHaveBeenCalled();
  });

  it("saves the composition as a new revision and closes", async () => {
    const composition = localComposition();
    composition.deliveryRoutes.push({
      routeId: "sftp-mirror",
      required: false,
      destination: {
        adapterId: "sftp",
        settingsVersion: 1,
        settings: {
          host: "mirror.example",
          remote_path: "/srv/releases",
          port: "",
        },
        credentials: { ssh_private_key: "keychain:one-publish/sftp-mirror" },
      },
    });
    const { props } = renderDialog({ profile: createProfile(composition) });

    fireEvent.click(await screen.findByTestId("composition-save"));

    await waitFor(() => {
      expect(props.onSaveComposition).toHaveBeenCalledTimes(1);
    });
    const [, saved] = props.onSaveComposition.mock.calls[0];
    const sftpRoute = saved.deliveryRoutes.find(
      (route: { routeId: string }) => route.routeId === "sftp-mirror"
    );
    // 空字符串设置不入库；合法凭据引用原样保存。
    expect(sftpRoute.destination.settings).toEqual({
      host: "mirror.example",
      remote_path: "/srv/releases",
    });
    expect(sftpRoute.destination.credentials).toEqual({
      ssh_private_key: "keychain:one-publish/sftp-mirror",
    });
    expect(toastSuccessMock).toHaveBeenCalled();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("rebinds the project explicitly and closes the editor", async () => {
    const { props } = renderDialog();

    fireEvent.click(await screen.findByTestId("composition-rebind"));

    await waitFor(() => {
      expect(props.onRebindProject).toHaveBeenCalledTimes(1);
    });
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
});
