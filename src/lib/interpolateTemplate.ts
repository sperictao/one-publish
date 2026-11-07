/**
 * 单次全局扫描替换 `{{key}}` 占位符。
 *
 * 相比逐键 `new RegExp` 或 `.replace("{{key}}", value)` 的写法，避免三类问题：
 * ① 键含正则元字符（.、(、+）时被误编译；
 * ② 插入值里的 `$&` / `$$` / `$'` / `` $` `` 被当作替换模式解释；
 * ③ 插入值里的 `{{...}}` 被后续参数二次展开，且字符串模式只替换首个占位符。
 * 未提供的 key 保持原样，插入值统一按字面量写入且不会被再次解析。
 */
export function interpolateTemplate(
  template: string,
  values: Record<string, string | number>
): string {
  return template.replace(/\{\{([^{}]+)\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key)
      ? String(values[key])
      : match
  );
}
