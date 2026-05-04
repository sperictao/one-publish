export interface TranslationMap {
  [key: string]: string | undefined;
}

export interface RunPublishOptions {
  repoId?: string | null;
  recentConfigKey?: string | null;
  openOutputDirOnSuccess?: boolean;
  restoreWindowOnFailure?: boolean;
  feedbackMode?: "toast" | "system";
  trayStatusEffect?: boolean;
}
