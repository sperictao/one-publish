import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { parseArgs as parseNodeArgs } from "node:util";

const rootDir = process.cwd();
const packageJsonPath = path.join(rootDir, "package.json");
const cargoTomlPath = path.join(rootDir, "src-tauri", "Cargo.toml");
const tauriConfigPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const cargoLockPath = path.join(rootDir, "src-tauri", "Cargo.lock");
const releaseNotesDir = path.join(rootDir, "release-notes");

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

function run(command, args, options = {}) {
  const { stdio = "pipe", allowFailure = false } = options;
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: "utf8",
    stdio,
  });

  if (result.error) {
    fail(`执行 ${command} 失败：${result.error.message}`);
  }

  if (result.status !== 0 && !allowFailure) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
    const details = stderr || stdout || `退出码 ${result.status}`;
    fail(`执行 ${command} ${args.join(" ")} 失败：${details}`);
  }

  return {
    status: result.status ?? 0,
    stdout: typeof result.stdout === "string" ? result.stdout.trim() : "",
    stderr: typeof result.stderr === "string" ? result.stderr.trim() : "",
  };
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
  const result = run("git", [
    "log",
    ...rangeArgs,
    "--pretty=format:%H%x09%h%x09%s",
  ]);

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

function printSummary(tag, version, notesPath, repoUrl, dryRun) {
  console.log("");
  console.log(dryRun ? "🧪 Dry run 完成" : "✅ 发布命令已完成");
  console.log(`- 版本：${version}`);
  console.log(`- 标签：${tag}`);
  console.log(`- Release Notes：${path.relative(rootDir, notesPath)}`);

  if (repoUrl) {
    console.log(`- Actions：${repoUrl}/actions`);
    console.log(`- Releases：${repoUrl}/releases/tag/${tag}`);
  }
}

function main() {
  const { version, tag, dryRun } = parseArgs(process.argv.slice(2));
  const currentVersion = getCurrentVersion();

  if (currentVersion === version) {
    fail(`当前版本已经是 ${version}，无需重复发布。`);
  }

  ensureReleaseReady(tag, dryRun);

  const previousTag = getPreviousTag();
  const commits = getCommitsSince(previousTag);
  const repoUrl = normalizeGitHubUrl(getOriginUrl());
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

  updateJsonVersion(packageJsonPath, version);
  updateCargoTomlVersion(version);
  updateJsonVersion(tauriConfigPath, version);
  updateCargoLockVersion(version);
  writeText(notesPath, releaseNotes);

  console.log("🚀 开始校验发布前状态...");
  run("pnpm", ["typecheck"], { stdio: "inherit" });
  run("pnpm", ["test:workflow"], { stdio: "inherit" });
  run("pnpm", ["test:updater"], { stdio: "inherit" });

  console.log("📝 提交发布版本与 release notes...");
  stageReleaseFiles(tag);
  run("git", ["commit", "-m", `chore(release): publish ${tag}`], {
    stdio: "inherit",
  });

  console.log("🏷️ 创建并推送标签...");
  run("git", ["tag", tag], { stdio: "inherit" });
  run("git", ["push", "origin", "main"], { stdio: "inherit" });
  run("git", ["push", "origin", tag], { stdio: "inherit" });

  printSummary(tag, version, notesPath, repoUrl, false);
}

main();
