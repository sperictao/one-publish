import assert from "node:assert/strict";

import {
  buildJobSnapshot,
  formatAnnotation,
  formatGitHubFetchError,
  getFailedSteps,
  isFailingConclusion,
  normalizeGitHubUrl,
  parseGitHubRepo,
  requestGitHub,
  selectWorkflowRun,
  trimLogForDisplay,
} from "./release.mjs";

assert.equal(
  normalizeGitHubUrl("git@github.com:sperictao/one-publish.git"),
  "https://github.com/sperictao/one-publish"
);
assert.deepEqual(parseGitHubRepo("https://github.com/sperictao/one-publish.git"), {
  owner: "sperictao",
  repo: "one-publish",
  slug: "sperictao/one-publish",
});

const workflowRun = selectWorkflowRun(
  [
    {
      id: 101,
      event: "push",
      head_sha: "abc123",
      head_branch: "main",
      display_title: "main",
      status: "completed",
      created_at: "2026-03-28T07:58:00Z",
    },
    {
      id: 202,
      event: "push",
      head_sha: "abc123",
      head_branch: "v0.2.1",
      display_title: "v0.2.1",
      status: "in_progress",
      created_at: "2026-03-28T08:00:15Z",
    },
    {
      id: 303,
      event: "workflow_dispatch",
      head_sha: "abc123",
      head_branch: "v0.2.1",
      display_title: "v0.2.1",
      status: "in_progress",
      created_at: "2026-03-28T08:00:20Z",
    },
  ],
  {
    headSha: "abc123",
    tag: "v0.2.1",
    notBeforeMs: Date.parse("2026-03-28T08:00:00Z"),
  }
);

assert.equal(workflowRun?.id, 202);

assert.equal(
  buildJobSnapshot(
    { status: "in_progress" },
    [
      { name: "release", status: "queued" },
      { name: "build-macos", status: "completed", conclusion: "success" },
    ]
  ),
  "run=in_progress | build-macos=success, release=queued"
);

assert.deepEqual(
  getFailedSteps({
    steps: [
      { name: "Install", conclusion: "success" },
      { name: "Build", conclusion: "failure" },
      { name: "Upload", conclusion: "cancelled" },
      { name: "Cleanup", conclusion: "skipped" },
    ],
  }),
  [
    { name: "Build", conclusion: "failure" },
    { name: "Upload", conclusion: "cancelled" },
  ]
);

assert.equal(isFailingConclusion("failure"), true);
assert.equal(isFailingConclusion("cancelled"), true);
assert.equal(isFailingConclusion("skipped"), false);
assert.equal(isFailingConclusion("success"), false);

assert.equal(
  formatAnnotation({
    title: "Cargo build",
    annotation_level: "failure",
    message: "missing libgtk dependency",
    path: "src-tauri/Cargo.toml",
    start_line: 48,
  }),
  "[failure] Cargo build: missing libgtk dependency (src-tauri/Cargo.toml:48)"
);

assert.equal(trimLogForDisplay("\u001b[31merror line\u001b[0m\nsecond line"), "error line\nsecond line");

assert.equal(
  formatGitHubFetchError(
    new TypeError("fetch failed", {
      cause: {
        code: "ECONNRESET",
        message: "socket hang up",
      },
    })
  ),
  "fetch failed (ECONNRESET, socket hang up)"
);

let retryAttempts = 0;
const originalWarn = console.warn;
const originalLog = console.log;
const warnings = [];
const logs = [];

console.warn = (...args) => {
  warnings.push(args.join(" "));
};

console.log = (...args) => {
  logs.push(args.join(" "));
};

try {
  const retriedResponse = await requestGitHub("https://api.github.com/repos/sperictao/one-publish", "", "重试测试", {
    fetchImpl: async () => {
      retryAttempts += 1;
      if (retryAttempts === 1) {
        throw new TypeError("fetch failed", {
          cause: {
            code: "ECONNRESET",
            message: "socket hang up",
          },
        });
      }

      return {
        ok: true,
        status: 200,
        text: async () => '{"ok":true}',
      };
    },
    sleepImpl: async () => {},
  });

  assert.equal(retryAttempts, 2);
  assert.equal(await retriedResponse.text(), '{"ok":true}');

  let ghFallbackCalled = false;
  const fallbackResponse = await requestGitHub(
    "https://api.github.com/repos/sperictao/one-publish/actions/workflows/build-release.yml/runs?event=push",
    "",
    "gh api 回退测试",
    {
      fetchImpl: async () => {
        throw new TypeError("fetch failed", {
          cause: {
            code: "ENETUNREACH",
            message: "network is unreachable",
          },
        });
      },
      ghApiRequest: async () => {
        ghFallbackCalled = true;
        return {
          response: {
            ok: true,
            status: 200,
            text: async () => '{"workflow_runs":[]}',
          },
        };
      },
      sleepImpl: async () => {},
      fallbackToGh: true,
    }
  );

  assert.equal(ghFallbackCalled, true);
  assert.equal(await fallbackResponse.text(), '{"workflow_runs":[]}');
} finally {
  console.warn = originalWarn;
  console.log = originalLog;
}

assert.equal(warnings.length, 1);
assert.equal(logs.length, 1);
assert.match(warnings[0], /请求 GitHub 重试测试 失败/);
assert.match(logs[0], /已自动切换 gh api 并继续/);

console.log("PASS: release 脚本等待与失败详情 helper 烟测通过。");
