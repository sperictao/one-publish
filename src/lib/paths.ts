const WINDOWS_DRIVE_RE = /^[a-zA-Z]:([\\/]|$)/;
const UNC_ROOT_RE = /^\\\\[^\\\/]+[\\\/][^\\\/]+[\\\/]?$/;

function isRootPath(path: string): boolean {
  return /^[\\/]+$/.test(path) || /^[a-zA-Z]:[\\/]?$/.test(path) || UNC_ROOT_RE.test(path);
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

export function isWindowsLikePath(path: string): boolean {
  return WINDOWS_DRIVE_RE.test(path) || path.includes("\\") || path.startsWith("\\\\");
}

export function stripTrailingPathSeparators(path: string): string {
  if (!path || isRootPath(path)) {
    return path;
  }
  return path.replace(/[\\/]+$/, "");
}

export function getPathBasename(path: string): string {
  const segments = splitPathSegments(path);
  return segments[segments.length - 1] || stripTrailingPathSeparators(path) || path;
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
    !rootSegments.every((segment, index) => {
      return normalizeSegment(segment, caseSensitive) ===
        normalizeSegment(pathSegments[index], caseSensitive);
    })
  ) {
    return path;
  }

  const separator = isWindowsLikePath(path) || isWindowsLikePath(root) ? "\\" : "/";
  return pathSegments.slice(rootSegments.length).join(separator) || getPathBasename(path);
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

    result = `${result}${isWindowsLikePath(result) ? "\\" : "/"}${part}`;
  }

  return result;
}

export function appendExtensionToPath(
  path: string,
  extension: string,
  fallbackBase = "artifact"
): string {
  const normalizedExtension = extension.startsWith(".") ? extension : `.${extension}`;
  const base = stripTrailingPathSeparators(path);

  if (!base) {
    return `${fallbackBase}${normalizedExtension}`;
  }

  if (isRootPath(base)) {
    return joinPath(base, `${fallbackBase}${normalizedExtension}`);
  }

  return `${base}${normalizedExtension}`;
}

export function isPathEqualOrInside(candidate: string, parent: string): boolean {
  if (!candidate || !parent) {
    return false;
  }

  const caseSensitive = preferCaseSensitivePathComparison([candidate, parent]);
  const candidateSegments = splitPathSegments(candidate);
  const parentSegments = splitPathSegments(parent);

  if (candidateSegments.length < parentSegments.length) {
    return false;
  }

  return parentSegments.every((segment, index) => {
    return normalizeSegment(segment, caseSensitive) ===
      normalizeSegment(candidateSegments[index], caseSensitive);
  });
}

export function remapPathPrefix(
  path: string,
  oldPrefix: string,
  newPrefix: string
): string {
  if (!path || !oldPrefix || oldPrefix === newPrefix) {
    return path;
  }

  const caseSensitive = preferCaseSensitivePathComparison([path, oldPrefix, newPrefix]);
  const pathSegments = splitPathSegments(path);
  const oldPrefixSegments = splitPathSegments(oldPrefix);

  if (
    pathSegments.length < oldPrefixSegments.length ||
    !oldPrefixSegments.every((segment, index) => {
      return normalizeSegment(segment, caseSensitive) ===
        normalizeSegment(pathSegments[index], caseSensitive);
    })
  ) {
    return path;
  }

  const suffixSegments = pathSegments.slice(oldPrefixSegments.length);
  return suffixSegments.length ? joinPath(newPrefix, ...suffixSegments) : newPrefix;
}
