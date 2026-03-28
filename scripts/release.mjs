import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { parseArgs as parseNodeArgs } from "node:util";
import { pathToFileURL } from "node:url";

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const cargoLockPath = path.join(rootDir, "src-tauri", "Cargo.lock");
const releaseNotesDir = path.join(rootDir, "release-notes");
const workflowFileName = "build-release.yml";
const workflowName = "build-release";
const workflowDiscoverTimeoutMs = 5 * 60 * 1000;
const workflowCompletionTimeoutMs = 2 * 60 * 60 * 1000;
const workflowPollIntervalMs = 10 * 1000;
const workflowCreatedAtGraceMs = 2 * 60 * 1000;
const maxFailureAnnotations = 5;
const maxFailureLogLines = 80;
const maxFailureLogChars = 4000;

function printUsage() {
  console.log(`用法:
  pnpm release --version <version>
  pnpm release --version <version> --dry-run
  pnpm release -v <version> -d

示例:
  pnpm release --version 0.2.1
  pnpm release --version 0.2.1 --dry-run
  pnpm release -v 0.2.1 -d

参数:
  --version, -v  发布版本号，例如 0.2.1
  --dry-run, -d  仅预演，不修改文件、不提交、不推送
  --help, -h     显示帮助`);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function runOptional(command, args, options = {}) {
  const { stdio = "pipe", env } = options;
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio,
    env: env ?? process.env,
  });

  return {
    status: result.status ?? (result.error ? 1 : 0),
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
    error: result.error ?? null,
  };
}

function run(command, args, options = {}) {
  const { allowFailure = false } = options;
  const result = runOptional(command, args, options);

  if (result.error && !allowFailure) {
    fail(`执行 ${command} 失败：${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    const details = result.stderr || result.stdout || `退出码 ${result.status}`;
    fail(`执行 ${command} ${args.join(" ")} 失败：${details}`);
  }

  return result;
}

function parseArgs(argv) {
  const normalizedArgv = argv.filter((arg) => arg !== "--");
  let parsed;

  try {
    parsed = parseNodeArgs({
      args: normalizedArgv,
      options: {
        version: {
          type: "string",
          short: "v",
        },
        "dry-run": {
          type: "boolean",
          short: "d",
        },
        help: {
          type: "boolean",
          short: "h",
        },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`参数解析失败：${message}`);
  }

  if (parsed.values.help) {
    printUsage();
    process.exit(0);
  }

  if (parsed.positionals.length > 0) {
    const attemptedVersion = parsed.positionals[0];
    fail(
      `已移除位置参数，请改用命名参数：pnpm release --version ${attemptedVersion}${
        parsed.values["dry-run"] ? " --dry-run" : ""
      }`
    );
  }

  const versionInput = parsed.values.version;

  if (!versionInput) {
    fail("缺少 --version 参数。\n示例：pnpm release --version 0.2.1");
  }

  const normalizedVersion = versionInput.replace(/^v/, "");
  const validVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalizedVersion);

  if (!validVersion) {
    fail(`版本号格式非法：${versionInput}`);
  }

  return {
    version: normalizedVersion,
    tag: `v${normalizedVersion}`,
    dryRun: parsed.values["dry-run"] ?? false,
  };
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function updateJsonVersion(filePath, version) {
  const data = JSON.parse(readText(filePath));
  data.version = version;
  writeText(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function replaceOrThrow(content, pattern, replacement, label) {
  const nextContent = content.replace(pattern, replacement);

  if (nextContent === content) {
    fail(`未找到 ${label} 的版本字段，无法继续发布。`);
  }

  return nextContent;
}

function updateCargoTomlVersion(version) {
  const content = readText(cargoTomlPath);
  const nextContent = replaceOrThrow(
    content,
    /(\[package\][\s\S]*?^version = ")([^"]+)(")/m,
    `$1${version}$3`,
    "Cargo.toml"
  );
  writeText(cargoTomlPath, nextContent);
}

function updateCargoLockVersion(version) {
  const content = readText(cargoLockPath);
  const nextContent = replaceOrThrow(
    content,
    /(\[\[package\]\]\nname = "one-publish"\nversion = ")([^"]+)(")/,
    `$1${version}$3`,
    "Cargo.lock"
  );
  writeText(cargoLockPath, nextContent);
}

function getCurrentVersion() {
  const pkg = JSON.parse(readText(packageJsonPath));
  return pkg.version;
}

function getCurrentBranch() {
  return run("git", ["rev-parse", "--abbrev-ref", "HEAD"]).stdout;
}

function getCurrentHeadSha() {
  return run("git", ["rev-parse", "HEAD"]).stdout;
}

function getOriginUrl() {
  return run("git", ["remote", "get-url", "origin"], { allowFailure: true }).stdout;
}

function normalizeGitHubUrl(remoteUrl) {
  if (!remoteUrl) {
    return "";
  }

  if (remoteUrl.startsWith("https://github.com/")) {
    return remoteUrl.replace(/\.git$/, "");
  }

  if (remoteUrl.startsWith("git@github.com:")) {
    return `https://github.com/${remoteUrl.slice("git@github.com:".length).replace(/\.git$/, "")}`;
  }

  return "";
}

function parseGitHubRepo(remoteUrl) {
  const normalizedUrl = normalizeGitHubUrl(remoteUrl);
  const match = normalizedUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)$/);

  if (!match) {
    return null;
  }

  const [, owner, repo] = match;
  return {
    owner,
    repo,
    slug: `${owner}/${repo}`,
  };
}

function ensureReleaseReady(tag, dryRun) {
  const branch = getCurrentBranch();

  if (branch !== "main") {
    fail(`请在 main 分支执行发布，当前分支为 ${branch}`);
  }

  const status = run("git", ["status", "--short"]).stdout;
  if (status && !dryRun) {
    fail("工作区不是干净状态，请先提交或清理改动后再发布。");
  }

  const localTag = run("git", ["tag", "--list", tag]).stdout;
  if (localTag) {
    fail(`本地标签 ${tag} 已存在。`);
  }
}

function getPreviousTag() {
  const result = run("git", ["describe", "--tags", "--abbrev=0"], { allowFailure: true });
  return result.status === 0 ? result.stdout : "";
}

function getCommitsSince(previousTag) {
  const rangeArgs = previousTag ? [`${previousTag}..HEAD`] : [];
  const result = run("git", ["log", ...rangeArgs, "--pretty=format:%H%x09%h%x09%s"]);

  if (!result.stdout) {
    return [];
  }

  return result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [fullHash, shortHash, subject] = line.split("\t");
      return {
        fullHash,
        shortHash,
        subject,
        type: resolveCommitType(subject),
      };
    });
}

function resolveCommitType(subject) {
  const match = subject.match(/^([a-zA-Z]+)(?:\([^)]+\))?!?:\s+/);
  const rawType = match?.[1]?.toLowerCase() ?? "";

  if (rawType === "feat") return "feature";
  if (rawType === "fix") return "fix";
  if (rawType === "refactor") return "refactor";
  if (rawType === "perf") return "perf";
  if (rawType === "docs") return "docs";
  if (rawType === "test") return "test";
  if (rawType === "build" || rawType === "ci") return "build";
  if (rawType === "chore") return "chore";
  return "other";
}

function groupCommits(commits) {
  const sections = [
    ["feature", "新功能"],
    ["fix", "问题修复"],
    ["refactor", "重构优化"],
    ["perf", "性能优化"],
    ["docs", "文档更新"],
    ["test", "测试与验证"],
    ["build", "构建与发布"],
    ["chore", "工程维护"],
    ["other", "其他变更"],
  ];

  return sections
    .map(([type, title]) => ({
      type,
      title,
      commits: commits.filter((commit) => commit.type === type),
    }))
    .filter((section) => section.commits.length > 0);
}

function buildCommitLine(commit, repoUrl) {
  const hashPart = repoUrl
    ? `[\`${commit.shortHash}\`](${repoUrl}/commit/${commit.fullHash})`
    : `\`${commit.shortHash}\``;

  return `- ${commit.subject} (${hashPart})`;
}

function formatLocalDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function buildReleaseNotes(tag, previousTag, commits, repoUrl) {
  const sections = groupCommits(commits);
  const today = formatLocalDate();
  const lines = [
    `# OnePublish ${tag}`,
    "",
    `- 发布日期：${today}`,
    `- 版本标签：\`${tag}\``,
  ];

  if (previousTag) {
    const compareText = repoUrl
      ? `[${previousTag}...${tag}](${repoUrl}/compare/${previousTag}...${tag})`
      : `${previousTag}...${tag}`;
    lines.push(`- 对比范围：${compareText}`);
  } else {
    lines.push("- 对比范围：首次发布");
  }

  lines.push(`- 变更提交：${commits.length} 个`, "", "## 变更摘要");

  if (sections.length === 0) {
    lines.push("- 本次版本主要用于发布编排或版本同步，没有新的功能提交。");
  } else {
    for (const section of sections) {
      lines.push("", `### ${section.title}`);
      for (const commit of section.commits) {
        lines.push(buildCommitLine(commit, repoUrl));
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

function stageReleaseFiles(tag) {
  const notesRelativePath = path.posix.join("release-notes", `${tag}.md`);
  run(
    "git",
    [
      "add",
      "package.json",
      "src-tauri/Cargo.toml",
      "src-tauri/tauri.conf.json",
      "src-tauri/Cargo.lock",
      notesRelativePath,
    ],
    { stdio: "inherit" }
  );
}

function printSummary(tag, version, notesPath, repoUrl, dryRun, workflowUrl = "") {
  console.log("");
  console.log(dryRun ? "🧪 Dry run 完成" : "✅ 发布命令已完成");
  console.log(`- 版本：${version}`);
  console.log(`- 标签：${tag}`);
  console.log(`- Release Notes：${path.relative(rootDir, notesPath)}`);

  if (workflowUrl) {
    console.log(`- Workflow：${workflowUrl}`);
  }

  if (repoUrl) {
    console.log(`- Actions：${repoUrl}/actions`);
    console.log(`- Releases：${repoUrl}/releases/tag/${tag}`);
  }
}

function formatDuration(durationMs) {
  const totalSeconds = Math.ceil(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours} 小时`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} 分钟`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} 秒`);
  }

  return parts.join("");
}

function sleep(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function getGitHubToken() {
  const envToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  if (envToken) {
    return envToken;
  }

  const ghToken = runOptional("gh", ["auth", "token"]);
  if (ghToken.status === 0 && ghToken.stdout) {
    return ghToken.stdout;
  }

  return "";
}

function getGitHubApiBase(repo) {
  return `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
}

function buildGitHubHeaders(token, accept = "application/vnd.github+json") {
  const headers = {
    Accept: accept,
    "User-Agent": "one-publish-release-script",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function formatGitHubError(status, bodyText) {
  const compactText = bodyText.replace(/\s+/g, " ").trim();

  if (!compactText) {
    return `HTTP ${status}`;
  }

  try {
    const payload = JSON.parse(bodyText);
    const message = typeof payload.message === "string" ? payload.message.trim() : "";
    if (message) {
      return `HTTP ${status}，${message}`;
    }
  } catch {}

  return `HTTP ${status}，${compactText.slice(0, 300)}`;
}

async function requestGitHub(url, token, label, options = {}) {
  const { allowFailure = false, accept } = options;

  let response;
  try {
    response = await fetch(url, {
      headers: buildGitHubHeaders(token, accept),
      redirect: "follow",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (allowFailure) {
      return null;
    }
    fail(`请求 GitHub ${label} 失败：${message}`);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    const errorDetails = formatGitHubError(response.status, bodyText);
    const authHint =
      response.status === 401 || response.status === 403
        ? " 如遇到权限或限流，请配置 GH_TOKEN / GITHUB_TOKEN，或重新执行 gh auth login。"
        : "";

    if (allowFailure) {
      return null;
    }

    fail(`请求 GitHub ${label} 失败：${errorDetails}.${authHint}`);
  }

  return response;
}

async function fetchGitHubJson(url, token, label, options = {}) {
  const response = await requestGitHub(url, token, label, options);
  if (!response) {
    return null;
  }

  const bodyText = await response.text();
  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.allowFailure) {
      return null;
    }
    fail(`解析 GitHub ${label} 响应失败：${message}`);
  }
}

async function fetchGitHubText(url, token, label, options = {}) {
  const response = await requestGitHub(url, token, label, options);
  if (!response) {
    return "";
  }

  return await response.text();
}

async function ensureGitHubApiReachable(repo, token) {
  const url = getGitHubApiBase(repo);
  await fetchGitHubJson(url, token, `仓库 ${repo.slug}`);
}

function scoreWorkflowRun(run, tag) {
  let score = 0;

  if (tag && run.head_branch === tag) {
    score += 2;
  }
  if (tag && run.display_title === tag) {
    score += 1;
  }
  if (run.status !== "completed") {
    score += 0.5;
  }

  return score;
}

function selectWorkflowRun(workflowRuns, options) {
  const { headSha, tag, notBeforeMs = 0 } = options;

  return [...workflowRuns]
    .filter((run) => run?.event === "push")
    .filter((run) => !headSha || run.head_sha === headSha)
    .filter((run) => {
      const createdAt = Date.parse(run.created_at || "");
      if (!Number.isFinite(createdAt)) {
        return true;
      }
      return createdAt >= notBeforeMs - workflowCreatedAtGraceMs;
    })
    .sort((left, right) => {
      const scoreDiff = scoreWorkflowRun(right, tag) - scoreWorkflowRun(left, tag);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return Date.parse(right.created_at || "") - Date.parse(left.created_at || "");
    })[0] ?? null;
}

async function waitForWorkflowRun(options) {
  const { repo, tag, headSha, token, notBeforeMs } = options;
  const workflowRunsUrl =
    `${getGitHubApiBase(repo)}/actions/workflows/${encodeURIComponent(workflowFileName)}/runs` +
    `?event=push&head_sha=${encodeURIComponent(headSha)}&per_page=20`;
  const deadline = Date.now() + workflowDiscoverTimeoutMs;

  console.log(`⏳ 等待 GitHub Actions 创建 ${workflowName} workflow run...`);

  while (Date.now() <= deadline) {
    const payload = await fetchGitHubJson(workflowRunsUrl, token, `${workflowName} 列表`);
    const workflowRuns = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
    const workflowRun = selectWorkflowRun(workflowRuns, {
      headSha,
      tag,
      notBeforeMs,
    });

    if (workflowRun) {
      console.log(`🔗 已发现 workflow run：${workflowRun.html_url}`);
      return workflowRun;
    }

    await sleep(workflowPollIntervalMs);
  }

  fail(
    `已推送 ${tag}，但在 ${formatDuration(workflowDiscoverTimeoutMs)} 内未发现 ${workflowName} workflow run。请到 Actions 页面确认 tag 是否触发成功。`
  );
}

async function getWorkflowRun(repo, runId, token) {
  const url = `${getGitHubApiBase(repo)}/actions/runs/${runId}`;
  return await fetchGitHubJson(url, token, `workflow run ${runId}`);
}

async function getWorkflowJobs(repo, runId, token) {
  const jobs = [];
  let page = 1;

  while (page <= 10) {
    const url = `${getGitHubApiBase(repo)}/actions/runs/${runId}/jobs?per_page=100&page=${page}`;
    const payload = await fetchGitHubJson(url, token, `workflow run ${runId} jobs 第 ${page} 页`);
    const pageJobs = Array.isArray(payload?.jobs) ? payload.jobs : [];

    jobs.push(...pageJobs);

    if (pageJobs.length < 100 || jobs.length >= (payload?.total_count ?? 0)) {
      break;
    }

    page += 1;
  }

  return jobs;
}

function translateConclusion(conclusion) {
  switch (conclusion) {
    case "success":
      return "成功";
    case "failure":
      return "失败";
    case "cancelled":
      return "已取消";
    case "timed_out":
      return "超时";
    case "skipped":
      return "已跳过";
    case "neutral":
      return "中性";
    case "action_required":
      return "需要人工处理";
    case "stale":
      return "已过期";
    case "startup_failure":
      return "启动失败";
    default:
      return conclusion || "未知";
  }
}

function translateStatus(status) {
  switch (status) {
    case "queued":
      return "排队中";
    case "in_progress":
      return "进行中";
    case "requested":
      return "已请求";
    case "waiting":
      return "等待中";
    case "pending":
      return "待处理";
    case "completed":
      return "已完成";
    default:
      return status || "未知";
  }
}

function getRunStateLabel(run) {
  if (run.status !== "completed") {
    return translateStatus(run.status);
  }

  return translateConclusion(run.conclusion);
}

function getJobStateLabel(job) {
  if (job.status !== "completed") {
    return translateStatus(job.status);
  }

  return translateConclusion(job.conclusion);
}

function buildJobSnapshot(run, jobs) {
  const parts = [...jobs]
    .sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")))
    .map((job) => `${job.name}=${job.status === "completed" ? job.conclusion || "completed" : job.status || "unknown"}`);

  return `run=${run.status === "completed" ? run.conclusion || "completed" : run.status || "unknown"}${
    parts.length > 0 ? ` | ${parts.join(", ")}` : ""
  }`;
}

async function waitForWorkflowCompletion(options) {
  const { repo, runId, token } = options;
  const deadline = Date.now() + workflowCompletionTimeoutMs;
  let lastSnapshot = "";
  let latestRun = null;
  let latestJobs = [];

  console.log("⏳ 等待 workflow jobs 完成...");

  while (Date.now() <= deadline) {
    const [workflowRun, jobs] = await Promise.all([
      getWorkflowRun(repo, runId, token),
      getWorkflowJobs(repo, runId, token),
    ]);

    latestRun = workflowRun;
    latestJobs = jobs;

    const snapshot = buildJobSnapshot(workflowRun, jobs);
    if (snapshot !== lastSnapshot) {
      console.log(`- ${snapshot}`);
      lastSnapshot = snapshot;
    }

    if (workflowRun.status === "completed") {
      return {
        workflowRun,
        jobs,
      };
    }

    await sleep(workflowPollIntervalMs);
  }

  const runUrl = latestRun?.html_url || "";
  fail(
    `已推送 tag，但等待 ${workflowName} 完成超过 ${formatDuration(workflowCompletionTimeoutMs)}。${
      runUrl ? `请继续查看：${runUrl}` : "请到 Actions 页面继续查看。"
    }`
  );
}

function sortJobsForReport(jobs) {
  return [...jobs].sort((left, right) => {
    const leftStartedAt = Date.parse(left.started_at || "");
    const rightStartedAt = Date.parse(right.started_at || "");

    if (Number.isFinite(leftStartedAt) && Number.isFinite(rightStartedAt) && leftStartedAt !== rightStartedAt) {
      return leftStartedAt - rightStartedAt;
    }

    return String(left.name || "").localeCompare(String(right.name || ""));
  });
}

function printWorkflowResult(workflowRun, jobs) {
  console.log("");
  console.log(`📦 GitHub Actions 结果：${getRunStateLabel(workflowRun)}`);

  for (const job of sortJobsForReport(jobs)) {
    console.log(`- ${job.name}: ${getJobStateLabel(job)}`);
  }
}

function isFailingConclusion(conclusion) {
  return Boolean(conclusion) && !["success", "neutral", "skipped"].includes(conclusion);
}

function getFailedJobs(jobs) {
  return jobs.filter((job) => job.status === "completed" && isFailingConclusion(job.conclusion));
}

function getFailedSteps(job) {
  return (job.steps ?? [])
    .filter((step) => step.conclusion && step.conclusion !== "success" && step.conclusion !== "skipped")
    .map((step) => ({
      name: step.name || `步骤 #${step.number ?? "?"}`,
      conclusion: step.conclusion || "unknown",
    }));
}

function formatFailedStep(step) {
  return `${step.name}（${translateConclusion(step.conclusion)}）`;
}

function extractCheckRunId(job) {
  const match = String(job.check_run_url || "").match(/\/check-runs\/(\d+)$/);
  return match?.[1] ?? "";
}

async function fetchJobAnnotations(repo, job, token) {
  const checkRunId = extractCheckRunId(job);
  if (!checkRunId) {
    return [];
  }

  const url = `${getGitHubApiBase(repo)}/check-runs/${checkRunId}/annotations?per_page=${maxFailureAnnotations}`;
  const annotations = await fetchGitHubJson(url, token, `${job.name} 注解`, {
    allowFailure: true,
  });

  return Array.isArray(annotations) ? annotations : [];
}

function stripAnsi(text) {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function trimLogForDisplay(logText) {
  const cleanedLines = stripAnsi(logText)
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  const tail = cleanedLines.slice(-maxFailureLogLines).join("\n").trim();
  if (!tail) {
    return "";
  }

  if (tail.length <= maxFailureLogChars) {
    return tail;
  }

  return `...省略前文...\n${tail.slice(-maxFailureLogChars)}`;
}

async function fetchJobLog(repo, job, token) {
  const url = `${getGitHubApiBase(repo)}/actions/jobs/${job.id}/logs`;
  const logText = await fetchGitHubText(url, token, `${job.name} 日志`, {
    allowFailure: true,
  });

  if (logText.trim()) {
    return logText;
  }

  const ghLog = runOptional("gh", ["run", "view", "--job", String(job.id), "--log-failed"]);
  if (ghLog.status === 0 && ghLog.stdout) {
    return ghLog.stdout;
  }

  return "";
}

function formatAnnotation(annotation) {
  const title = annotation.title ? `${annotation.title}: ` : "";
  const level = annotation.annotation_level ? `[${annotation.annotation_level}] ` : "";
  const location = annotation.path
    ? `${annotation.path}${annotation.start_line ? `:${annotation.start_line}` : ""}`
    : "";
  const message = String(annotation.message || "").replace(/\s+/g, " ").trim();

  if (!message) {
    return "";
  }

  return `${level}${title}${message}${location ? ` (${location})` : ""}`;
}

async function collectFailedJobDetails(repo, jobs, token) {
  const failedJobs = getFailedJobs(jobs);

  return await Promise.all(
    failedJobs.map(async (job) => {
      const [annotations, logText] = await Promise.all([
        fetchJobAnnotations(repo, job, token),
        fetchJobLog(repo, job, token),
      ]);

      return {
        job,
        failedSteps: getFailedSteps(job),
        annotations: annotations.map(formatAnnotation).filter(Boolean).slice(0, maxFailureAnnotations),
        logExcerpt: trimLogForDisplay(logText),
      };
    })
  );
}

function printFailureDetails(failedJobDetails) {
  if (failedJobDetails.length === 0) {
    return;
  }

  console.log("");
  console.log("❌ 失败详情：");

  for (const detail of failedJobDetails) {
    console.log("");
    console.log(`- Job：${detail.job.name}`);

    if (detail.job.html_url) {
      console.log(`  链接：${detail.job.html_url}`);
    }

    if (detail.failedSteps.length > 0) {
      console.log(`  失败步骤：${detail.failedSteps.map(formatFailedStep).join("、")}`);
    }

    if (detail.annotations.length > 0) {
      console.log("  注解：");
      for (const annotation of detail.annotations) {
        console.log(`    - ${annotation}`);
      }
    }

    if (detail.logExcerpt) {
      console.log("  日志摘录：");
      for (const line of detail.logExcerpt.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    if (!detail.failedSteps.length && !detail.annotations.length && !detail.logExcerpt) {
      console.log("  未获取到更多失败详情，请打开 job 链接查看完整日志。");
    }
  }
}

async function waitForReleaseWorkflow(options) {
  const workflowRun = await waitForWorkflowRun(options);
  const result = await waitForWorkflowCompletion({
    repo: options.repo,
    runId: workflowRun.id,
    token: options.token,
  });

  return {
    workflowRun: result.workflowRun,
    jobs: result.jobs,
  };
}

async function main() {
  const { version, tag, dryRun } = parseArgs(process.argv.slice(2));
  const currentVersion = getCurrentVersion();

  if (currentVersion === version) {
    fail(`当前版本已经是 ${version}，无需重复发布。`);
  }

  ensureReleaseReady(tag, dryRun);

  const previousTag = getPreviousTag();
  const commits = getCommitsSince(previousTag);
  const originUrl = getOriginUrl();
  const repoUrl = normalizeGitHubUrl(originUrl);
  const repo = parseGitHubRepo(originUrl);
  const gitHubToken = getGitHubToken();
  const notesPath = path.join(releaseNotesDir, `${tag}.md`);
  const releaseNotes = buildReleaseNotes(tag, previousTag, commits, repoUrl);

  if (dryRun) {
    console.log(`即将发布 ${tag}`);
    console.log(`当前版本：${currentVersion}`);
    console.log(`上一标签：${previousTag || "无"}`);
    console.log("");
    console.log(releaseNotes);
    printSummary(tag, version, notesPath, repoUrl, true);
    return;
  }

  if (!repo) {
    fail("无法从 origin 解析 GitHub 仓库地址，无法等待 release workflow。");
  }

  console.log("🔍 校验 GitHub API 访问...");
  await ensureGitHubApiReachable(repo, gitHubToken);

  updateJsonVersion(packageJsonPath, version);
  updateCargoTomlVersion(version);
  updateJsonVersion(tauriConfigPath, version);
  updateCargoLockVersion(version);
  writeText(notesPath, releaseNotes);

  console.log("🚀 开始校验发布前状态...");
  run("pnpm", ["typecheck"], { stdio: "inherit" });
  run("pnpm", ["test:workflow"], { stdio: "inherit" });
  run("pnpm", ["test:updater"], { stdio: "inherit" });
  run("pnpm", ["test:release"], { stdio: "inherit" });

  console.log("📝 提交发布版本与 release notes...");
  stageReleaseFiles(tag);
  run("git", ["commit", "-m", `chore(release): publish ${tag}`], {
    stdio: "inherit",
  });

  const releaseCommitSha = getCurrentHeadSha();

  console.log("🏷️ 创建并推送标签...");
  run("git", ["tag", tag], { stdio: "inherit" });
  run("git", ["push", "origin", "main"], { stdio: "inherit" });

  const workflowSearchStartedAt = Date.now();
  run("git", ["push", "origin", tag], { stdio: "inherit" });

  const { workflowRun, jobs } = await waitForReleaseWorkflow({
    repo,
    tag,
    headSha: releaseCommitSha,
    token: gitHubToken,
    notBeforeMs: workflowSearchStartedAt,
  });

  printWorkflowResult(workflowRun, jobs);

  const failedJobDetails = await collectFailedJobDetails(repo, jobs, gitHubToken);
  if (failedJobDetails.length > 0 || workflowRun.conclusion !== "success") {
    printFailureDetails(failedJobDetails);
    fail(
      `GitHub Actions ${workflowName} 未成功完成。workflow：${workflowRun.html_url || `${repoUrl}/actions`}`
    );
  }

  printSummary(tag, version, notesPath, repoUrl, false, workflowRun.html_url || "");
}

const isDirectExecution =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;

export {
  buildJobSnapshot,
  formatAnnotation,
  getFailedSteps,
  isFailingConclusion,
  normalizeGitHubUrl,
  parseGitHubRepo,
  selectWorkflowRun,
  trimLogForDisplay,
};

if (isDirectExecution) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  });
}
