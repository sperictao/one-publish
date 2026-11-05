import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const i18nMocks = vi.hoisted(() => ({
  translations: {} as Record<string, Record<string, string>>,
}));

vi.mock("@/hooks/useI18n", () => ({
  useI18n: () => ({ translations: i18nMocks.translations }),
}));

import { DeleteProfileConfirmDialog } from "@/components/publish/DeleteProfileConfirmDialog";
import type { ConfigProfile } from "@/lib/store/types";

function profile(name: string): ConfigProfile {
  return {
    id: "profile-1",
    revisionId: "revision-1",
    name,
    providerId: "dotnet",
    parameters: {},
    createdAt: "2026-01-01T00:00:00Z",
    isSystemDefault: false,
    externalBindingIds: [],
    blockedReason: null,
  };
}

function renderDialog(name: string) {
  render(
    <DeleteProfileConfirmDialog
      profile={profile(name)}
      onClose={() => {}}
      onConfirm={() => {}}
    />
  );
}

beforeEach(() => {
  i18nMocks.translations = {};
});

describe("DeleteProfileConfirmDialog description", () => {
  it("renders a profile name containing $ replacement patterns literally", () => {
    const raw = "release$&-$$-$'-$`";

    renderDialog(raw);

    expect(screen.getByText(`确定删除配置「${raw}」？`)).toBeInTheDocument();
  });

  it("expands every {{name}} placeholder and keeps unknown ones intact", () => {
    i18nMocks.translations = {
      profiles: {
        deleteConfirmDescription: "删除 {{name}} / {{name}}（保留 {{other}}）",
      },
    };

    renderDialog("prod");

    expect(
      screen.getByText("删除 prod / prod（保留 {{other}}）")
    ).toBeInTheDocument();
  });

  it("does not re-expand placeholder-like text inside a profile name", () => {
    const raw = "cfg{{name}}";

    renderDialog(raw);

    expect(screen.getByText(`确定删除配置「${raw}」？`)).toBeInTheDocument();
  });

  it("keeps the default description for an ordinary profile name", () => {
    renderDialog("正式发布");

    expect(screen.getByText("确定删除配置「正式发布」？")).toBeInTheDocument();
  });
});
