import assert from "node:assert/strict";

import {
  buildJobSnapshot,
  formatAnnotation,
  getFailedSteps,
  isFailingConclusion,
  normalizeGitHubUrl,
  parseGitHubRepo,
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

console.log("PASS: release 脚本等待与失败详情 helper 烟测通过。");
