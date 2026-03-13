import { useCallback, useMemo } from "react";

interface TranslationMap {
  [key: string]: string | undefined;
}

export function usePresetText(configT: TranslationMap) {
  const presetTextMap = useMemo(
    () => ({
      "release-fd": {
        name: configT.releaseFd || "Release - 框架依赖",
        description: configT.releaseFdDesc || "推荐用于开发/测试",
      },
      "release-win-x64": {
        name: configT.releaseWin || "Release - Windows x64",
        description: configT.releaseWinDesc || "自包含部署",
      },
      "release-osx-arm64": {
        name: configT.releaseOsxA || "Release - macOS ARM64",
        description: configT.releaseOsxADesc || "Apple Silicon",
      },
      "release-osx-x64": {
        name: configT.releaseOsxX || "Release - macOS x64",
        description: configT.releaseOsxXDesc || "Intel Mac",
      },
      "release-linux-x64": {
        name: configT.releaseLinux || "Release - Linux x64",
        description: configT.releaseLinuxDesc || "自包含部署",
      },
      "debug-fd": {
        name: configT.debugFd || "Debug - 框架依赖",
        description: configT.debugFdDesc || "调试模式",
      },
      "debug-win-x64": {
        name: configT.debugWin || "Debug - Windows x64",
        description: configT.debugWinDesc || "自包含部署",
      },
      "debug-osx-arm64": {
        name: configT.debugOsxA || "Debug - macOS ARM64",
        description: configT.debugOsxADesc || "Apple Silicon",
      },
      "debug-osx-x64": {
        name: configT.debugOsxX || "Debug - macOS x64",
        description: configT.debugOsxXDesc || "Intel Mac",
      },
      "debug-linux-x64": {
        name: configT.debugLinux || "Debug - Linux x64",
        description: configT.debugLinuxDesc || "自包含部署",
      },
    }),
    [configT]
  );

  const getPresetText = useCallback(
    (presetId: string, fallbackName: string, fallbackDescription: string) => {
      const presetText =
        presetTextMap[presetId as keyof typeof presetTextMap] || null;
      return {
        name: presetText?.name || fallbackName,
        description: presetText?.description || fallbackDescription,
      };
    },
    [presetTextMap]
  );

  return {
    presetTextMap,
    getPresetText,
  };
}
