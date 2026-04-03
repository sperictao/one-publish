import { parseArgs as parseNodeArgs } from "node:util";

export function printReleaseUsage() {
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

export function parseReleaseArgs(argv) {
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
    throw new Error(`参数解析失败：${message}`);
  }

  if (parsed.values.help) {
    return {
      helpRequested: true,
      version: "",
      tag: "",
      dryRun: false,
    };
  }

  if (parsed.positionals.length > 0) {
    const attemptedVersion = parsed.positionals[0];
    throw new Error(
      `已移除位置参数，请改用命名参数：pnpm release --version ${attemptedVersion}${
        parsed.values["dry-run"] ? " --dry-run" : ""
      }`
    );
  }

  const versionInput = parsed.values.version;
  if (!versionInput) {
    throw new Error("缺少 --version 参数。\n示例：pnpm release --version 0.2.1");
  }

  const normalizedVersion = versionInput.replace(/^v/, "");
  const validVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalizedVersion);
  if (!validVersion) {
    throw new Error(`版本号格式非法：${versionInput}`);
  }

  return {
    helpRequested: false,
    version: normalizedVersion,
    tag: `v${normalizedVersion}`,
    dryRun: parsed.values["dry-run"] ?? false,
  };
}
