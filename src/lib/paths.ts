const WINDOWS_DRIVE_RE = /^[a-zA-Z]:([\\/]|$)/;
const UNC_ROOT_RE = /^\\\\[^\\/]+[\\/][^\\/]+[\\/]?$/;

function isRootPath(path: string): boolean {
  return (
    /^[\\/]+$/.test(path) ||
    /^[a-zA-Z]:[\\/]?$/.test(path) ||
    UNC_ROOT_RE.test(path)
  );
}

function splitPathSegments(path: string): string[] {
  return stripTrailingPathSeparators(path)
    .split(/[\\/]+/)
    .filter(Boolean);
}

function preferCaseSensitivePathComparison(paths: string[]): boolean {
  return !paths.some(isWindowsLikePath);
}

function normalizeSegment(segment: string, caseSensitive: boolean): string {
  return caseSensitive ? segment : segment.toLowerCase();
}

function pathSegmentsMatch(
  left: string[],
  right: string[],
  length: number,
  caseSensitive: boolean
): boolean {
  if (left.length < length || right.length < length) {
    return false;
  }
  for (let i = 0; i < length; i++) {
    if (
      normalizeSegment(left[i], caseSensitive) !==
      normalizeSegment(right[i], caseSensitive)
    ) {
      return false;
    }
  }
  return true;
}

function isWindowsLikePath(path: string): boolean {
  return (
    WINDOWS_DRIVE_RE.test(path) ||
    path.includes("\\") ||
    path.startsWith("\\\\")
  );
}

/**
 * 只对「确定是 Windows 路径」的写法统一分隔符（盘符路径或反斜杠 UNC）。
 * 比 isWindowsLikePath 更严格：后者把任何含反斜杠的路径都视作 Windows 风格，
 * 而 POSIX 路径里的 `\` 其实是合法文件名字符，不能当作分隔符归一化；
 * 同理 `//` 开头的 POSIX 路径也不会被误判成 UNC。
 */
function normalizeWindowsSeparators(path: string): string {
  const isDefiniteWindowsPath =
    WINDOWS_DRIVE_RE.test(path) || path.startsWith("\\\\");
  return isDefiniteWindowsPath ? path.replace(/\\/g, "/") : path;
}

export function stripTrailingPathSeparators(path: string): string {
  if (!path || isRootPath(path)) {
    return path;
  }
  return path.replace(/[\\/]+$/, "");
}

/**
 * 判定两个路径是否指向同一个仓库目录。
 *
 * 仅做「写法归一化」而不解析符号链接：去掉首尾空白与尾部分隔符，并在
 * Windows 风格路径下忽略大小写。与 paths.ts 其余比较逻辑保持一致
 * （POSIX 路径按大小写敏感处理）。
 */
export function isSameRepositoryPath(left: string, right: string): boolean {
  const normalizedLeft = stripTrailingPathSeparators((left ?? "").trim());
  const normalizedRight = stripTrailingPathSeparators((right ?? "").trim());

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  const caseSensitive = preferCaseSensitivePathComparison([
    normalizedLeft,
    normalizedRight,
  ]);

  // Windows 目录选择器返回 `C:\repo`，而导入/持久化的配置常写成 `C:/repo`；
  // UNC 同理（`\\nas01\share` 与 `//nas01/share`）。两种写法在 Windows 上
  // 指向同一目录，逐字符比较会让「前端预检重复目录」失效，把同一仓库添加两次。
  // 各侧按自身写法归一化：只有确定的 Windows 路径才把 `\` 当分隔符，
  // POSIX 路径（含 `//` 开头）保持原样，不同目录仍不相等。
  return (
    normalizeSegment(
      normalizeWindowsSeparators(normalizedLeft),
      caseSensitive
    ) ===
    normalizeSegment(normalizeWindowsSeparators(normalizedRight), caseSensitive)
  );
}

export function getPathBasename(path: string): string {
  const segments = splitPathSegments(path);
  return (
    segments[segments.length - 1] || stripTrailingPathSeparators(path) || path
  );
}

export function getPathRelativeToRoot(path: string, root: string): string {
  if (!path || !root) {
    return path;
  }

  const caseSensitive = preferCaseSensitivePathComparison([path, root]);
  const pathSegments = splitPathSegments(path);
  const rootSegments = splitPathSegments(root);

  if (
    pathSegments.length <= rootSegments.length ||
    !pathSegmentsMatch(
      pathSegments,
      rootSegments,
      rootSegments.length,
      caseSensitive
    )
  ) {
    return path;
  }

  // 与 joinPath 一致：分隔符跟随输入写法，`C:/repo` 下的相对路径
  // 用 `/` 而非 `\`，避免产出与输入风格不一致的混合分隔符。
  const separator = path.includes("\\") || root.includes("\\") ? "\\" : "/";
  return (
    pathSegments.slice(rootSegments.length).join(separator) ||
    getPathBasename(path)
  );
}

export function joinPath(...parts: string[]): string {
  let result = "";

  for (const rawPart of parts) {
    if (!rawPart) {
      continue;
    }

    if (!result) {
      result = rawPart;
      continue;
    }

    const part = rawPart.replace(/^[\\/]+/, "");
    if (!part) {
      continue;
    }

    if (/[\\/]$/.test(result)) {
      result = `${result}${part}`;
      continue;
    }

    // 分隔符跟随 result 自己的写法：含 `\` 的 Windows 路径继续用 `\`，
    // 正斜杠写法（含 `C:/repo` 这类 Windows 盘符路径）继续用 `/`——
    // 否则 `C:/repo` + `out` 会产出 `C:/repo\out` 混合分隔符。
    result = `${result}${result.includes("\\") ? "\\" : "/"}${part}`;
  }

  return result;
}

export function appendExtensionToPath(
  path: string,
  extension: string,
  fallbackBase = "artifact"
): string {
  const normalizedExtension = extension.startsWith(".")
    ? extension
    : `.${extension}`;
  const base = stripTrailingPathSeparators(path);

  if (!base) {
    return `${fallbackBase}${normalizedExtension}`;
  }

  if (isRootPath(base)) {
    return joinPath(base, `${fallbackBase}${normalizedExtension}`);
  }

  return `${base}${normalizedExtension}`;
}

export function isPathEqualOrInside(
  candidate: string,
  parent: string
): boolean {
  // 与同文件 isSameRepositoryPath 的写法归一化保持一致：持久化的项目路径
  // 可能带首尾空白（见 specFromRecord / publishExecutionRecord），不裁剪会把
  // "  /repo  " 切成 ["  ", "repo  "]，使 isRecordInRepository 在 repoId
  // 缺失时误判历史记录不属于当前仓库。只裁剪首尾，词内空白仍参与比较。
  const normalizedCandidate = (candidate ?? "").trim();
  const normalizedParent = (parent ?? "").trim();

  if (!normalizedCandidate || !normalizedParent) {
    return false;
  }

  const caseSensitive = preferCaseSensitivePathComparison([
    normalizedCandidate,
    normalizedParent,
  ]);
  const candidateSegments = splitPathSegments(normalizedCandidate);
  const parentSegments = splitPathSegments(normalizedParent);

  return pathSegmentsMatch(
    candidateSegments,
    parentSegments,
    parentSegments.length,
    caseSensitive
  );
}

export function remapPathPrefix(
  path: string,
  oldPrefix: string,
  newPrefix: string
): string {
  if (!path || !oldPrefix || oldPrefix === newPrefix) {
    return path;
  }

  const caseSensitive = preferCaseSensitivePathComparison([
    path,
    oldPrefix,
    newPrefix,
  ]);
  const pathSegments = splitPathSegments(path);
  const oldPrefixSegments = splitPathSegments(oldPrefix);

  if (
    !pathSegmentsMatch(
      pathSegments,
      oldPrefixSegments,
      oldPrefixSegments.length,
      caseSensitive
    )
  ) {
    return path;
  }

  const suffixSegments = pathSegments.slice(oldPrefixSegments.length);
  return suffixSegments.length
    ? joinPath(newPrefix, ...suffixSegments)
    : newPrefix;
}
