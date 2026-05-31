import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useEnvironmentStatus } from "@/features/environment/useEnvironmentStatus";
import type { EnvironmentCheckSnapshot, EnvironmentCheckResult } from "@/features/environment/environment";

const multiProviderResult: EnvironmentCheckResult = {
  is_ready: false,
  providers: [
    {
      provider_id: "dotnet",
      installed: true,
      version: "9.0.100",
      path: "/usr/local/bin/dotnet",
    },
    {
      provider_id: "java",
      installed: false,
      version: null,
      path: null,
    },
  ],
  issues: [
    {
      severity: "critical",
      provider_id: "java",
      issue_type: "missing_tool",
      description: "Java (JDK) not found",
      current_value: "not installed",
      expected_value: "11+",
      fixes: [],
    },
  ],
  checked_at: "2026-03-30T08:00:00.000Z",
};

const multiProviderCheck: EnvironmentCheckSnapshot = {
  providerIds: ["dotnet", "java"],
  result: multiProviderResult,
};

describe("useEnvironmentStatus", () => {
  it("忽略非当前 provider 的阻断问题", () => {
    const { result } = renderHook(() =>
      useEnvironmentStatus(multiProviderCheck, "dotnet")
    );

    expect(result.current).toBe("ready");
  });

  it("当前 provider 存在警告时返回 warning", () => {
    const { result } = renderHook(() =>
      useEnvironmentStatus(
        {
          providerIds: ["dotnet"],
          result: {
            ...multiProviderResult,
            is_ready: true,
            providers: [multiProviderResult.providers[0]],
            issues: [
              {
                severity: "warning",
                provider_id: "dotnet",
                issue_type: "outdated_version",
                description: ".NET SDK version outdated",
                current_value: "5.0.0",
                expected_value: "6.0.0+",
                fixes: [],
              },
            ],
          },
        },
        "dotnet"
      )
    );

    expect(result.current).toBe("warning");
  });

  it("结果未覆盖当前 provider 时返回 unknown", () => {
    const { result } = renderHook(() =>
      useEnvironmentStatus(
        {
          providerIds: ["dotnet"],
          result: {
            ...multiProviderResult,
            providers: [multiProviderResult.providers[0]],
            issues: [],
            is_ready: true,
          },
        },
        "cargo"
      )
    );

    expect(result.current).toBe("unknown");
  });
});
