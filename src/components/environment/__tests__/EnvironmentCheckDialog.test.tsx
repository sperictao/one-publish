import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EnvironmentCheckDialog } from "@/components/environment/EnvironmentCheckDialog";
import type { EnvironmentCheckResult } from "@/generated/tauri-contracts";
import type { ProviderManifest } from "@/lib/store/types";

const mocks = vi.hoisted(() => ({
  runEnvironmentCheck: vi.fn(),
  applyFix: vi.fn(),
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@/features/environment/environment", async (importOriginal) => {
  const mod =
    await importOriginal<typeof import("@/features/environment/environment")>();
  return {
    ...mod,
    runEnvironmentCheck: mocks.runEnvironmentCheck,
    applyFix: mocks.applyFix,
  };
});

vi.mock("@/hooks/useI18n", async () => {
  const zh = (await import("@/i18n/zh.json")).default;
  return { useI18n: () => ({ translations: zh }) };
});

const dotnetManifest: ProviderManifest = {
  id: "dotnet",
  displayName: ".NET",
  version: "1",
  label: ".NET",
  commandExample: "dotnet publish",
  environmentLabel: ".NET SDK",
  environmentDescription: ".NET toolchain",
  requiresProjectBinding: true,
  projectPathKind: "project_file",
  supportsCommandImport: true,
};

function checkResult(marker: string): EnvironmentCheckResult {
  return {
    is_ready: false,
    providers: [
      { provider_id: "dotnet", installed: true, version: "8.0.0", path: null },
    ],
    issues: [
      {
        severity: "warning",
        provider_id: "dotnet",
        issue_type: "outdated_version",
        description: marker,
        current_value: null,
        expected_value: null,
        fixes: [],
      },
    ],
    checked_at: "2026-02-09T00:00:00Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog(open = true) {
  return render(
    <EnvironmentCheckDialog
      open={open}
      onOpenChange={vi.fn()}
      providers={[dotnetManifest]}
    />
  );
}

describe("EnvironmentCheckDialog 在途检查回收", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("关闭后再打开时，迟到响应不得落回新会话或回调父级", async () => {
    const stale = deferred<EnvironmentCheckResult>();
    const fresh = deferred<EnvironmentCheckResult>();
    mocks.runEnvironmentCheck
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    const onChecked = vi.fn();

    const { rerender } = render(
      <EnvironmentCheckDialog
        open
        onOpenChange={vi.fn()}
        providers={[dotnetManifest]}
        onChecked={onChecked}
      />
    );
    await waitFor(() =>
      expect(mocks.runEnvironmentCheck).toHaveBeenCalledTimes(1)
    );

    // Radix 在 open=false 时卸载内容：关闭再打开是一个全新组件实例。
    rerender(
      <EnvironmentCheckDialog
        open={false}
        onOpenChange={vi.fn()}
        providers={[dotnetManifest]}
        onChecked={onChecked}
      />
    );
    rerender(
      <EnvironmentCheckDialog
        open
        onOpenChange={vi.fn()}
        providers={[dotnetManifest]}
        onChecked={onChecked}
      />
    );

    await waitFor(() =>
      expect(mocks.runEnvironmentCheck).toHaveBeenCalledTimes(2)
    );

    // 旧实例的迟到响应必须被丢弃：不渲染、不回调父级。
    await act(async () => {
      stale.resolve(checkResult("stale-issue-marker"));
      await stale.promise;
    });
    expect(screen.queryByText(/stale-issue-marker/)).not.toBeInTheDocument();
    expect(onChecked).not.toHaveBeenCalled();

    await act(async () => {
      fresh.resolve(checkResult("fresh-issue-marker"));
      await fresh.promise;
    });
    expect(await screen.findByText(/fresh-issue-marker/)).toBeInTheDocument();
    expect(onChecked).toHaveBeenCalledTimes(1);
  });

  it("切换 provider 让在途检查过期，迟到结果不得落地", async () => {
    const stale = deferred<EnvironmentCheckResult>();
    mocks.runEnvironmentCheck.mockReturnValueOnce(stale.promise);
    renderDialog();
    await waitFor(() =>
      expect(mocks.runEnvironmentCheck).toHaveBeenCalledTimes(1)
    );

    // 关掉唯一 provider 的开关：选择集合变化使在途检查过期。
    const toggle = screen.getByRole("button", { name: /.NET SDK/ });
    fireEvent.click(toggle);

    await act(async () => {
      stale.resolve(checkResult("stale-after-toggle"));
      await stale.promise;
    });

    expect(screen.queryByText(/stale-after-toggle/)).not.toBeInTheDocument();
  });
});
