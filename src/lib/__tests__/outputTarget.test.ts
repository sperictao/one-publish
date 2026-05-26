import { describe, expect, it } from "vitest";

import { parseOutputTargetLocal } from "@/lib/outputTarget";

describe("parseOutputTargetLocal", () => {
  it("treats empty string as local", () => {
    expect(parseOutputTargetLocal("")).toEqual({ kind: "local" });
    expect(parseOutputTargetLocal("   ")).toEqual({ kind: "local" });
  });

  it("classifies regular POSIX path as local", () => {
    expect(parseOutputTargetLocal("/Users/alice/build")).toEqual({
      kind: "local",
    });
    expect(parseOutputTargetLocal("./publish/win-x64")).toEqual({
      kind: "local",
    });
  });

  it("classifies Windows drive path as local (single-letter scheme is ambiguous)", () => {
    expect(parseOutputTargetLocal("C:\\publish")).toEqual({ kind: "local" });
  });

  it("classifies backslash UNC path as unc", () => {
    expect(parseOutputTargetLocal("\\\\nas01\\share\\app")).toEqual({
      kind: "unc",
    });
  });

  it("classifies forward-slash UNC path as unc", () => {
    expect(parseOutputTargetLocal("//nas01/share/app")).toEqual({
      kind: "unc",
    });
  });

  it("classifies sftp:// as scheme", () => {
    expect(parseOutputTargetLocal("sftp://deploy@host/path")).toEqual({
      kind: "scheme",
      scheme: "sftp",
    });
  });

  it("classifies s3:// as scheme", () => {
    expect(parseOutputTargetLocal("s3://bucket/prefix")).toEqual({
      kind: "scheme",
      scheme: "s3",
    });
  });

  it("normalizes scheme to lowercase", () => {
    expect(parseOutputTargetLocal("SFTP://deploy@host/path")).toEqual({
      kind: "scheme",
      scheme: "sftp",
    });
  });
});
