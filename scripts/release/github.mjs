export function normalizeGitHubUrl(remoteUrl) {
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

export function parseGitHubRepo(remoteUrl) {
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
