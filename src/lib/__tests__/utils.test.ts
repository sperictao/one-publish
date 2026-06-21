import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("keeps button foreground color when merging Geist text size tokens", () => {
    expect(cn("bg-primary text-primary-foreground text-button-14")).toBe(
      "bg-primary text-primary-foreground text-button-14"
    );
    expect(cn("text-foreground text-heading-14")).toBe(
      "text-foreground text-heading-14"
    );
  });

  it("still resolves competing Geist text size tokens", () => {
    expect(cn("text-button-14 text-button-16")).toBe("text-button-16");
    expect(cn("text-label-12 text-copy-14")).toBe("text-copy-14");
  });
});
