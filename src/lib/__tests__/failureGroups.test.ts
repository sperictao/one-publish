import { describe, expect, it } from "vitest";

import type { ExecutionRecord } from "@/lib/store";
import {
  getRepresentativeRecord,
  groupExecutionFailures,
} from "@/lib/failureGroups";

function createRecord(
  overrides: Partial<ExecutionRecord> & Pick<ExecutionRecord, "id" | "finishedAt">
): ExecutionRecord {
  const { id, finishedAt, ...rest } = overrides;

  return {
    id,
    providerId: "dotnet",
    projectPath: "/tmp/demo",
    startedAt: "2026-02-08T10:00:00.000Z",
    finishedAt,
    success: false,
    cancelled: false,
    outputDir: null,
    error: "build failed",
    commandLine: null,
    snapshotPath: null,
    failureSignature: "build failed",
    spec: null,
    fileCount: 0,
    ...rest,
  };
}

describe("failureGroups", () => {
  it("按 provider + signature 聚合并按频次排序", () => {
    const records: ExecutionRecord[] = [
      createRecord({
        id: "g1-1",
        finishedAt: "2026-02-08T10:00:00.000Z",
        providerId: "dotnet",
        failureSignature: "missing sdk",
      }),
      createRecord({
        id: "g1-2",
        finishedAt: "2026-02-08T11:00:00.000Z",
        providerId: "dotnet",
        failureSignature: "missing sdk",
      }),
      createRecord({
        id: "g2-1",
        finishedAt: "2026-02-08T12:00:00.000Z",
        providerId: "cargo",
        failureSignature: "toolchain missing",
      }),
      createRecord({
        id: "ok-1",
        finishedAt: "2026-02-08T13:00:00.000Z",
        success: true,
        failureSignature: null,
      }),
    ];

    const groups = groupExecutionFailures(records);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.key).toBe("dotnet::missing sdk");
    expect(groups[0]?.count).toBe(2);
    expect(groups[1]?.key).toBe("cargo::toolchain missing");
  });

  it("组内记录按完成时间倒序输出", () => {
    const records: ExecutionRecord[] = [
      createRecord({
        id: "r1",
        finishedAt: "2026-02-08T09:00:00.000Z",
        failureSignature: "timeout",
      }),
      createRecord({
        id: "r2",
        finishedAt: "2026-02-08T11:00:00.000Z",
        failureSignature: "timeout",
      }),
      createRecord({
        id: "r3",
        finishedAt: "2026-02-08T10:00:00.000Z",
        failureSignature: "timeout",
      }),
    ];

    const [group] = groupExecutionFailures(records);

    expect(group?.latestRecord.id).toBe("r2");
    expect(group?.records.map((record) => record.id)).toEqual([
      "r2",
      "r3",
      "r1",
    ]);
  });

  it("优先选择包含命令行的代表记录", () => {
    const records: ExecutionRecord[] = [
      createRecord({
        id: "latest-without-cmd",
        finishedAt: "2026-02-08T11:00:00.000Z",
        commandLine: null,
        failureSignature: "panic",
      }),
      createRecord({
        id: "older-with-cmd",
        finishedAt: "2026-02-08T10:00:00.000Z",
        commandLine: "$ dotnet publish demo.csproj",
        failureSignature: "panic",
      }),
    ];

    const [group] = groupExecutionFailures(records);
    const representative = getRepresentativeRecord(group!);

    expect(representative.id).toBe("older-with-cmd");
  });
});
