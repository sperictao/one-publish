import { describe, expect, it } from "vitest";

import {
  appendExtensionToPath,
  getPathBasename,
  joinPath,
  remapPathPrefix,
} from "@/lib/paths";

describe("paths", () => {
  it("提取 Windows 风格路径的 basename", () => {
    expect(getPathBasename("C:\\workspace\\one-publish")).toBe("one-publish");
    expect(getPathBasename("C:/workspace/demo/app.csproj")).toBe("app.csproj");
  });

  it("拼接路径时保留 Windows 分隔符", () => {
    expect(joinPath("C:\\workspace\\one-publish", "publish", "release")).toBe(
      "C:\\workspace\\one-publish\\publish\\release"
    );
  });

  it("追加扩展名时会去掉末尾分隔符", () => {
    expect(appendExtensionToPath("/tmp/output/", ".zip")).toBe("/tmp/output.zip");
    expect(appendExtensionToPath("C:\\workspace\\output\\", ".zip")).toBe(
      "C:\\workspace\\output.zip"
    );
  });

  it("重映射路径前缀时兼容 Windows 大小写和分隔符", () => {
    expect(
      remapPathPrefix(
        "C:/Workspace/OnePublish/src/App.csproj",
        "c:\\workspace\\onepublish",
        "D:\\Repos\\OnePublish"
      )
    ).toBe("D:\\Repos\\OnePublish\\src\\App.csproj");
  });
});
