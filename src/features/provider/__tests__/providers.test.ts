import { describe, expect, it } from "vitest";

import {
  providerRequiresProjectBinding,
  providerUsesProjectFile,
  resolveEnvironmentProviderOptions,
  resolveProviderCommandExample,
  resolveProviderIdCandidate,
  resolveProviderLabel,
} from "@/features/provider/providers";
import type { ProviderManifest } from "@/lib/store/types";

function provider(overrides: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    id: "dotnet",
    displayName: ".NET",
    ...overrides,
  } as ProviderManifest;
}

describe("resolveProviderIdCandidate", () => {
  it("keeps an explicit selection over catalog order", () => {
    expect(
      resolveProviderIdCandidate("cargo", [provider({ id: "dotnet" })])
    ).toBe("cargo");
  });

  it("falls back to the configured fallback before the catalog", () => {
    expect(
      resolveProviderIdCandidate(null, [provider()], "explicit-fallback")
    ).toBe("explicit-fallback");
  });

  it("uses the first catalog entry, then empty string", () => {
    expect(resolveProviderIdCandidate("  ", [provider({ id: "dotnet" })])).toBe(
      "dotnet"
    );
    expect(resolveProviderIdCandidate(null, [])).toBe("");
  });
});

describe("resolveProviderLabel", () => {
  it("prefers label > displayName > id > fallback", () => {
    expect(
      resolveProviderLabel(provider({ label: "Custom", displayName: ".NET" }))
    ).toBe("Custom");
    expect(resolveProviderLabel(provider({ displayName: ".NET" }))).toBe(
      ".NET"
    );
    expect(
      resolveProviderLabel(
        provider({ label: " ", displayName: " ", id: "dotnet" })
      )
    ).toBe("dotnet");
    expect(resolveProviderLabel(undefined, "cargo")).toBe("cargo");
    expect(resolveProviderLabel(null)).toBe("Provider");
  });
});

describe("resolveProviderCommandExample", () => {
  it("returns the trimmed example or empty string", () => {
    expect(
      resolveProviderCommandExample(provider({ commandExample: " dotnet " }))
    ).toBe("dotnet");
    expect(resolveProviderCommandExample(provider())).toBe("");
    expect(resolveProviderCommandExample(null)).toBe("");
  });
});

describe("project binding resolution", () => {
  it("maps project_file kind to uses-project-file", () => {
    expect(
      providerUsesProjectFile(provider({ projectPathKind: "project_file" }))
    ).toBe(true);
    expect(providerUsesProjectFile(provider())).toBe(false);
    expect(providerUsesProjectFile(undefined)).toBe(false);
  });

  it("defaults requiresProjectBinding to the project-file kind", () => {
    expect(providerRequiresProjectBinding(provider())).toBe(false);
    expect(
      providerRequiresProjectBinding(
        provider({ projectPathKind: "project_file" })
      )
    ).toBe(true);
    expect(
      providerRequiresProjectBinding(
        provider({
          requiresProjectBinding: false,
          projectPathKind: "project_file",
        })
      )
    ).toBe(false);
  });
});

describe("resolveEnvironmentProviderOptions", () => {
  it("prefers environment label/description with fallbacks", () => {
    const options = resolveEnvironmentProviderOptions([
      provider({
        id: "dotnet",
        displayName: ".NET SDK",
        environmentLabel: "dotnet-sdk",
        environmentDescription: "Checks dotnet",
      }),
      provider({ id: "cargo", displayName: "Cargo" }),
    ]);

    expect(options).toEqual([
      {
        id: "dotnet",
        label: "dotnet-sdk",
        description: "Checks dotnet",
      },
      { id: "cargo", label: "Cargo", description: "Cargo" },
    ]);
  });

  it("skips blank environment copy and falls back to trimmed presentation", () => {
    const options = resolveEnvironmentProviderOptions([
      provider({
        id: "dotnet",
        displayName: ".NET SDK",
        label: "  .NET CLI  ",
        environmentLabel: "   ",
        environmentDescription: " \t ",
      }),
    ]);

    expect(options).toEqual([
      { id: "dotnet", label: ".NET CLI", description: ".NET SDK" },
    ]);
  });

  it("trims surrounding whitespace from environment copy", () => {
    const options = resolveEnvironmentProviderOptions([
      provider({
        id: "go",
        displayName: "  Go Toolchain  ",
        environmentLabel: "  Go  ",
        environmentDescription: "  checks go  ",
      }),
    ]);

    expect(options).toEqual([
      { id: "go", label: "Go", description: "checks go" },
    ]);
  });

  it("never renders blank options when every copy candidate is blank", () => {
    const options = resolveEnvironmentProviderOptions([
      provider({
        id: "  ",
        displayName: "  ",
        label: " ",
        environmentLabel: "\t",
        environmentDescription: "\n",
      }),
    ]);

    expect(options).toEqual([
      { id: "  ", label: "Provider", description: "Provider" },
    ]);
  });
});
