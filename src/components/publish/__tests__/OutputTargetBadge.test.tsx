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
});
