/**
 * `navigator.clipboard.writeText` 在部分 webview（WebKitGTK、非安全上下文）
 * 不可用或会被拒绝；统一走 `execCommand` 兜底，调用方只需处理最终成败。
 * 失败时尽量保留 writeText 的原始错误，便于诊断提示携带真实原因。
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      if (!tryExecCommandCopy(text)) {
        throw error;
      }
      return;
    }
  }

  if (!tryExecCommandCopy(text)) {
    throw new Error("copy failed");
  }
}

function tryExecCommandCopy(text: string): boolean {
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.focus();
  input.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}
