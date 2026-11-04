import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { OutputTargetBadge } from "@/components/publish/OutputTargetBadge";
import type { OutputTargetDescriptor } from "@/generated/tauri-contracts";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

beforeEach(() => {
  invokeMock.mockReset();
});

describe("OutputTargetBadge", () => {
  it("renders local badge synchronously for a regular path", () => {
    invokeMock.mockResolvedValue({
      kind: "local",
      raw: "/Users/alice/build",
      path: "/Users/alice/build",
      mountKind: null,
      fsType: null,
      scheme: null,
      host: null,
      port: null,
      user: null,
      query: null,
    } satisfies OutputTargetDescriptor);

    render(<OutputTargetBadge raw="/Users/alice/build" />);
    expect(screen.getByText("本地")).toBeInTheDocument();
  });

  it("renders UNC badge synchronously for a UNC path before IPC resolves", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    render(<OutputTargetBadge raw="\\\\nas01\\share\\app" />);
    expect(screen.getByText("UNC 共享")).toBeInTheDocument();
  });

  it("renders SFTP badge for sftp:// scheme", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    render(<OutputTargetBadge raw="sftp://deploy@host/var/www" />);
    expect(screen.getByText(/SFTP/)).toBeInTheDocument();
  });

  it("prefers the backend local verdict over the optimistic scheme hint", async () => {
    invokeMock.mockResolvedValue({
      kind: "local",
      raw: "sftp:///only-path",
      path: "sftp:///only-path",
      mountKind: null,
      fsType: null,
      scheme: null,
      host: null,
      port: null,
      user: null,
      query: null,
    } satisfies OutputTargetDescriptor);

    render(<OutputTargetBadge raw="sftp:///only-path" />);
    await waitFor(() => {
      expect(screen.getByText("本地")).toBeInTheDocument();
    });
    expect(screen.queryByText(/SFTP/)).toBeNull();
  });

  it.each(["//nas01", "\\\\nas01"])(
    "prefers the backend local verdict over the optimistic UNC hint for %s",
    async (raw) => {
      // 缺 share 的不完整 UNC 会被后端 try_parse_unc 拒绝并回退为 Local，
      // 但前端乐观 hint 仍判为 unc；后端权威结果到达后应显示本地。
      invokeMock.mockResolvedValue({
        kind: "local",
        raw,
        path: raw,
        mountKind: null,
        fsType: null,
        scheme: null,
        host: null,
        port: null,
        user: null,
        query: null,
      } satisfies OutputTargetDescriptor);

      render(<OutputTargetBadge raw={raw} />);
      await waitFor(() => {
        expect(screen.getByText("本地")).toBeInTheDocument();
      });
      expect(screen.queryByText(/UNC 共享/)).toBeNull();
    }
  );

  it("keeps the UNC badge when the backend confirms a mounted UNC share", async () => {
    invokeMock.mockResolvedValue({
      kind: "mounted_remote",
      raw: "//nas01/share/app",
      path: "//nas01/share/app",
      mountKind: "unc",
      fsType: null,
      scheme: null,
      host: "nas01",
      port: null,
      user: null,
      query: null,
    } satisfies OutputTargetDescriptor);

    render(<OutputTargetBadge raw="//nas01/share/app" />);
    // host detail 只有后端权威 descriptor 到达后才出现，用它确认 IPC 已解析。
    await waitFor(() => {
      expect(screen.getByText("nas01")).toBeInTheDocument();
    });
    expect(screen.getByText(/UNC 共享/)).toBeInTheDocument();
    expect(screen.queryByText("本地")).toBeNull();
  });

  it("keeps the SFTP badge when the backend confirms a remote target", async () => {
    invokeMock.mockResolvedValue({
      kind: "remote",
      raw: "sftp://host/path",
      path: "/path",
      mountKind: null,
      fsType: null,
      scheme: "sftp",
      host: "host",
      port: null,
      user: null,
      query: null,
    } satisfies OutputTargetDescriptor);

    render(<OutputTargetBadge raw="sftp://host/path" />);
    await waitFor(() => {
      expect(screen.getByText(/SFTP/)).toBeInTheDocument();
    });
    expect(screen.queryByText("本地")).toBeNull();
  });

  it("returns null for empty raw", () => {
    const { container } = render(<OutputTargetBadge raw="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("upgrades to fs_type detail after IPC resolves for mounted remote", async () => {
    invokeMock.mockResolvedValue({
      kind: "mounted_remote",
      raw: "/Volumes/build-share/publish",
      path: "/Volumes/build-share/publish",
      mountKind: "mounted",
      fsType: "smbfs",
      scheme: null,
      host: null,
      port: null,
      user: null,
      query: null,
    } satisfies OutputTargetDescriptor);

    render(<OutputTargetBadge raw="/Volumes/build-share/publish" />);
    await waitFor(() => {
      expect(screen.getByText(/挂载远程卷 \(smbfs\)/)).toBeInTheDocument();
    });
  });

  it("shows host detail and UNC label for a mounted UNC share", async () => {
    invokeMock.mockResolvedValue({
      kind: "mounted_remote",
      raw: "\\\\nas01\\share\\app",
      path: "/Volumes/share/app",
      mountKind: "unc",
      fsType: "smbfs",
      scheme: null,
      host: "nas01",
      port: null,
      user: null,
      query: null,
    } satisfies OutputTargetDescriptor);

    render(<OutputTargetBadge raw="\\\\nas01\\share\\app" />);
    await waitFor(() => {
      expect(screen.getByText(/UNC 共享 \(smbfs\)/)).toBeInTheDocument();
      expect(screen.getByTitle("UNC 共享 (smbfs) · nas01")).toBeInTheDocument();
    });
  });

  it("falls back to REMOTE label when descriptor scheme is empty", async () => {
    invokeMock.mockResolvedValue({
      kind: "remote",
      raw: "custom://edge/bucket",
      path: "/bucket",
      mountKind: null,
      fsType: null,
      scheme: null,
      host: "edge",
      port: null,
      user: null,
      query: null,
    } satisfies OutputTargetDescriptor);

    render(<OutputTargetBadge raw="custom://edge/bucket" />);
    await waitFor(() => {
      expect(screen.getByText("CUSTOM")).toBeInTheDocument();
      expect(screen.getByText("edge/bucket")).toBeInTheDocument();
      expect(
        screen.getByTitle("远程协议将在 Phase 13 启用上传")
      ).toBeInTheDocument();
    });
  });

  it("drops stale remote descriptor immediately when input changes", async () => {
    invokeMock.mockResolvedValue({
      kind: "remote",
      raw: "sftp://deploy@nas01/var/www",
      path: "/var/www",
      mountKind: null,
      fsType: null,
      scheme: "sftp",
      host: "nas01",
      port: null,
      user: "deploy",
      query: null,
    } satisfies OutputTargetDescriptor);

    const { rerender } = render(
      <OutputTargetBadge raw="sftp://deploy@nas01/var/www" />
    );
    await waitFor(() => {
      expect(screen.getByText(/SFTP/)).toBeInTheDocument();
    });

    rerender(<OutputTargetBadge raw="/Users/alice/build" />);
    expect(screen.queryByText(/SFTP/)).toBeNull();
    expect(screen.getByText("本地")).toBeInTheDocument();
  });
});
