import { describe, expect, it } from "vitest";

import {
  appendExtensionToPath,
  getPathBasename,
  getPathRelativeToRoot,
  isPathEqualOrInside,
  isSameRepositoryPath,
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
    expect(appendExtensionToPath("/tmp/output/", ".zip")).toBe(
      "/tmp/output.zip"
    );
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

  it("提取相对根目录的路径", () => {
    expect(
      getPathRelativeToRoot(
        "/workspace/demo/src/App/App.csproj",
        "/workspace/demo"
      )
    ).toBe("src/App/App.csproj");
  });

  it("提取相对根目录的路径时兼容 Windows 大小写和分隔符", () => {
    expect(
      getPathRelativeToRoot(
        "C:/Workspace/Demo/src/App/App.csproj",
        "c:\\workspace\\demo"
      )
    ).toBe("src\\App\\App.csproj");
  });

  it("无法映射为相对路径时保留原路径", () => {
    expect(
      getPathRelativeToRoot(
        "/workspace/other/src/App/App.csproj",
        "/workspace/demo"
      )
    ).toBe("/workspace/other/src/App/App.csproj");
  });

  it("判定同一仓库目录时忽略尾部分隔符与首尾空白", () => {
    expect(
      isSameRepositoryPath(
        "/Users/dev/work/payments-api/",
        "/Users/dev/work/payments-api"
      )
    ).toBe(true);
    expect(
      isSameRepositoryPath(
        "  /Users/dev/work/payments-api  ",
        "/Users/dev/work/payments-api"
      )
    ).toBe(true);
  });

  it("只有 Windows 风格路径忽略大小写，POSIX 路径保持大小写敏感", () => {
    expect(
      isSameRepositoryPath("C:\\Work\\Payments-API\\", "c:\\work\\payments-api")
    ).toBe(true);
    expect(
      isSameRepositoryPath(
        "/Users/dev/work/Payments-API",
        "/Users/dev/work/payments-api"
      )
    ).toBe(false);
  });

  it("空路径永不相等，不同目录不相等", () => {
    expect(isSameRepositoryPath("", "")).toBe(false);
    expect(isSameRepositoryPath("/a/b", "/a/c")).toBe(false);
  });

  it("任一侧为空（含 null）时同一仓库判定为 false", () => {
    expect(isSameRepositoryPath(null as unknown as string, "/repo")).toBe(
      false
    );
    expect(isSameRepositoryPath("/repo", undefined as unknown as string)).toBe(
      false
    );
  });

  it("空输入的 basename 回落到 strip 与原值", () => {
    expect(getPathBasename("")).toBe("");
    expect(getPathBasename("///")).toBe("///");
  });

  it("getPathRelativeToRoot 对空参数与更短候选返回原路径", () => {
    expect(getPathRelativeToRoot("", "/repo")).toBe("");
    expect(getPathRelativeToRoot("/repo/a", "")).toBe("/repo/a");
    expect(getPathRelativeToRoot("/repo", "/repo/sub")).toBe("/repo");
  });

  it("joinPath 跳过空段、纯分隔符段并尊重既有尾部分隔符", () => {
    expect(joinPath("a", "", "b")).toBe("a/b");
    expect(joinPath("a", "///")).toBe("a");
    expect(joinPath("a/", "b")).toBe("a/b");
    expect(joinPath("C:\\repo", "out")).toBe("C:\\repo\\out");
  });

  it("appendExtensionToPath 对无点扩展名、空基名与根路径给出兜底", () => {
    expect(appendExtensionToPath("/repo/out", "zip")).toBe("/repo/out.zip");
    expect(appendExtensionToPath("", ".md")).toBe("artifact.md");
    expect(appendExtensionToPath("/", ".md")).toBe("/artifact.md");
  });

  it("isPathEqualOrInside 覆盖包含判定与空参数拒绝", () => {
    expect(isPathEqualOrInside("/repo/sub", "/repo")).toBe(true);
    expect(isPathEqualOrInside("/repo", "/repo")).toBe(true);
    expect(isPathEqualOrInside("/repo/sub", "/other")).toBe(false);
    // 候选比父级更短 → 段数守卫直接 false
    expect(isPathEqualOrInside("/repo", "/repo/sub")).toBe(false);
    expect(isPathEqualOrInside("", "/repo")).toBe(false);
    expect(isPathEqualOrInside("/repo", "")).toBe(false);
    // Windows 大小写不敏感匹配
    expect(isPathEqualOrInside("C:\\Repo\\Sub", "c:\\repo")).toBe(true);
  });

  it("remapPathPrefix 对空参数、相同前缀与非前缀路径原样返回", () => {
    expect(remapPathPrefix("", "/a", "/b")).toBe("");
    expect(remapPathPrefix("/a/x", "", "/b")).toBe("/a/x");
    expect(remapPathPrefix("/a/x", "/a", "/a")).toBe("/a/x");
    expect(remapPathPrefix("/other/x", "/a", "/b")).toBe("/other/x");
    // 路径与前缀完全相等时直接换为新前缀
    expect(remapPathPrefix("/repo", "/repo", "/new")).toBe("/new");
  });
});
