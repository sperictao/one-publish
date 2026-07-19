import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createDotnetPublishConfigFromParameters } from "@/features/config/dotnetPublishConfig";
import { createProjectProfileConfigKey } from "@/features/config/publishConfigIdentity";
import type { ProviderPublishSpec } from "@/features/publish/publishRuntime";
import { useRecoverableSpec } from "@/hooks/useRecoverableSpec";
import type { ExecutionRecord, JsonValue } from "@/lib/store/types";
import {
  fromSpecParameters,
  type ParameterValue,
  type SpecParameters,
} from "@/types/parameters";

const SPEC_VERSION = 3;

function setup() {
  const setCustomConfig = vi.fn();
  const setIsCustomMode = vi.fn();
  const applyRecoveredSpecProvider = vi.fn();
  const setProviderParameters = vi.fn();

  const hook = renderHook(() =>
    useRecoverableSpec({
      specVersion: SPEC_VERSION,
      setCustomConfig,
      setIsCustomMode,
      applyRecoveredSpecProvider,
      setProviderParameters,
    })
  );

  return {
    hook,
    setCustomConfig,
    setIsCustomMode,
    applyRecoveredSpecProvider,
    setProviderParameters,
  };
}

function createRecord(spec: JsonValue | null): ExecutionRecord {
  return {
    id: "history-1",
    providerId: "dotnet",
    projectPath: "/repo/App.csproj",
    startedAt: "2026-04-02T10:00:00.000Z",
    finishedAt: "2026-04-02T10:00:03.000Z",
    success: true,
    cancelled: false,
    fileCount: 2,
    spec,
  };
}

function createSpec(
  overrides: Partial<ProviderPublishSpec> = {}
): ProviderPublishSpec {
  return {
    version: SPEC_VERSION,
    provider_id: "dotnet",
    project_path: "/repo/App.csproj",
    parameters: {},
    ...overrides,
  };
}

describe("useRecoverableSpec", () => {
  describe("extractSpecFromRecord", () => {
    const cases: Array<{
      name: string;
      spec: JsonValue | null;
      expected: ProviderPublishSpec | null;
    }> = [
      {
        name: "returns null when spec is null",
        spec: null,
        expected: null,
      },
      {
        name: "returns null when spec is a string",
        spec: "str",
        expected: null,
      },
      {
        name: "returns null when spec is an array",
        spec: [1],
        expected: null,
      },
      {
        name: "returns null when provider_id is missing",
        spec: { project_path: "/p" },
        expected: null,
      },
      {
        name: "returns null when project_path is missing",
        spec: { provider_id: "go" },
        expected: null,
      },
      {
        name: "falls back to the current spec version when version is absent",
        spec: { provider_id: "go", project_path: "/p" },
        expected: {
          version: SPEC_VERSION,
          provider_id: "go",
          project_path: "/p",
          parameters: {},
        },
      },
      {
        name: "falls back to the current spec version when version is not a number",
        spec: { provider_id: "go", project_path: "/p", version: "x" },
        expected: {
          version: SPEC_VERSION,
          provider_id: "go",
          project_path: "/p",
          parameters: {},
        },
      },
      {
        name: "keeps a valid numeric version",
        spec: { provider_id: "go", project_path: "/p", version: 2 },
        expected: {
          version: 2,
          provider_id: "go",
          project_path: "/p",
          parameters: {},
        },
      },
      {
        name: "falls back to empty parameters when parameters is an array",
        spec: { provider_id: "go", project_path: "/p", parameters: [1] },
        expected: {
          version: SPEC_VERSION,
          provider_id: "go",
          project_path: "/p",
          parameters: {},
        },
      },
      {
        name: "falls back to empty parameters when parameters is a string",
        spec: { provider_id: "go", project_path: "/p", parameters: "x" },
        expected: {
          version: SPEC_VERSION,
          provider_id: "go",
          project_path: "/p",
          parameters: {},
        },
      },
      {
        name: "rebuilds a complete payload as-is",
        spec: {
          version: 2,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
            self_contained: true,
            properties: { PublishProfile: "FolderProfile" },
          },
        },
        expected: {
          version: 2,
          provider_id: "dotnet",
          project_path: "/repo/App.csproj",
          parameters: {
            configuration: "Release",
            self_contained: true,
            properties: { PublishProfile: "FolderProfile" },
          },
        },
      },
    ];

    it.each(cases)("$name", ({ spec, expected }) => {
      const { hook } = setup();

      expect(
        hook.result.current.extractSpecFromRecord(createRecord(spec))
      ).toEqual(expected);
    });
  });

  describe("restoreSpecToEditor", () => {
    it("restores dotnet specs into the custom config editor", () => {
      const {
        hook,
        setCustomConfig,
        setIsCustomMode,
        applyRecoveredSpecProvider,
        setProviderParameters,
      } = setup();
      const parameters: SpecParameters = {
        configuration: "Release",
        properties: { PublishProfile: "FolderProfile" },
      };
      const spec = createSpec({ provider_id: "dotnet", parameters });

      hook.result.current.restoreSpecToEditor(spec);

      expect(applyRecoveredSpecProvider).toHaveBeenCalledWith("dotnet");
      expect(setIsCustomMode).toHaveBeenCalledWith(true);
      expect(setCustomConfig).toHaveBeenCalledWith(
        createDotnetPublishConfigFromParameters(parameters, {
          inferProfileSelection: true,
        })
      );
      expect(setProviderParameters).not.toHaveBeenCalled();
    });

    it("restores non-dotnet specs into provider parameters without touching other providers", () => {
      const {
        hook,
        setCustomConfig,
        setIsCustomMode,
        applyRecoveredSpecProvider,
        setProviderParameters,
      } = setup();
      const parameters: SpecParameters = { output: "./bin/app", release: true };
      const spec = createSpec({
        provider_id: "go",
        project_path: "/repo",
        parameters,
      });

      hook.result.current.restoreSpecToEditor(spec);

      expect(applyRecoveredSpecProvider).toHaveBeenCalledWith("go");
      expect(setCustomConfig).not.toHaveBeenCalled();
      expect(setIsCustomMode).not.toHaveBeenCalled();
      expect(setProviderParameters).toHaveBeenCalledTimes(1);

      const updater = setProviderParameters.mock.calls[0][0] as (
        prev: Record<string, Record<string, ParameterValue>>
      ) => Record<string, Record<string, ParameterValue>>;
      const prev = { dotnet: { configuration: "Debug" } };
      const next = updater(prev);

      expect(next).toEqual({
        dotnet: { configuration: "Debug" },
        go: fromSpecParameters(parameters),
      });
      // 不可变更新：prev 不被改写，其他 provider 键保持原引用
      expect(prev).toEqual({ dotnet: { configuration: "Debug" } });
      expect(next.dotnet).toBe(prev.dotnet);
    });
  });

  describe("getRecentConfigKeyFromSpec", () => {
    const cases: Array<{
      name: string;
      spec: ProviderPublishSpec;
      expected: string | null;
    }> = [
      {
        name: "returns null for non-dotnet providers",
        spec: createSpec({ provider_id: "go" }),
        expected: null,
      },
      {
        name: "returns null for dotnet specs without properties",
        spec: createSpec({ parameters: {} }),
        expected: null,
      },
      {
        name: "returns null when properties is an array",
        spec: createSpec({ parameters: { properties: [1] } }),
        expected: null,
      },
      {
        name: "returns null when PublishProfile is empty",
        spec: createSpec({
          parameters: { properties: { PublishProfile: "" } },
        }),
        expected: null,
      },
      {
        name: "returns null when PublishProfile is only whitespace",
        spec: createSpec({
          parameters: { properties: { PublishProfile: "   " } },
        }),
        expected: null,
      },
      {
        name: "maps a PublishProfile to the project profile config key",
        spec: createSpec({
          parameters: { properties: { PublishProfile: "FolderProfile" } },
        }),
        expected: createProjectProfileConfigKey("FolderProfile"),
      },
    ];

    it.each(cases)("$name", ({ spec, expected }) => {
      const { hook } = setup();

      expect(hook.result.current.getRecentConfigKeyFromSpec(spec)).toBe(
        expected
      );
    });
  });
});
