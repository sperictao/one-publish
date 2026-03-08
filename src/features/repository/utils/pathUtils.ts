export function remapPathPrefix(
  path: string,
  oldPrefix: string,
  newPrefix: string
): string {
  if (!oldPrefix || oldPrefix === newPrefix) {
    return path;
  }

  if (path === oldPrefix) {
    return newPrefix;
  }

  if (path.startsWith(`${oldPrefix}/`) || path.startsWith(`${oldPrefix}\\`)) {
    return `${newPrefix}${path.slice(oldPrefix.length)}`;
  }

  return path;
}
