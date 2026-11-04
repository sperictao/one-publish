/**
 * 日志行诊断级别分类。唯一规则模块，用于发布日志逐行着色。
 *
 * 语义对齐：与 Rust 侧 PublishResult.warnings 的提取一样，识别 .NET/MSBuild
 * 诊断格式（`: error CS1002`、`: warning MSB3277`），此处额外兼容行首
 * `error:` / `warning:` 前缀。两者是各自独立实现，此模块只服务前端着色，
 * 不与后端汇总数据交叉，故无需共享代码；改动诊断格式时两处需同步。
 */
export type LogLineLevel = "error" | "warning" | "plain";

// `: error CS1002:` / `: warning MSB3277:` —— 编译器/构建诊断码。
// 诊断码字母前缀长度不设上限：NETSDK1138、SYSLIB1001 等 6 字母前缀同样合法，
// 限定 {1,5} 会把这些常见 .NET SDK 诊断误判为普通输出行。
const DIAGNOSTIC_ERROR = /:\s*error\s+[A-Za-z]+\d+/;
const DIAGNOSTIC_WARNING = /:\s*warning\s+[A-Za-z]+\d+/;
// 行首 error: / warning:（大小写不敏感），覆盖无诊断码的一般输出
const PREFIX_ERROR = /^\s*error\s*:/i;
const PREFIX_WARNING = /^\s*warning\s*:/i;

export function classifyLogLine(line: string): LogLineLevel {
  if (DIAGNOSTIC_ERROR.test(line) || PREFIX_ERROR.test(line)) {
    return "error";
  }
  if (DIAGNOSTIC_WARNING.test(line) || PREFIX_WARNING.test(line)) {
    return "warning";
  }
  return "plain";
}
