# 修复 ts-rs serde 属性解析警告

## Goal

消除启动/契约生成过程中 `ts-rs failed to parse this attribute` 的警告，保持 Rust 序列化行为和前端生成类型契约不变。

## What I already know

- 警告文本指向 `#[serde(default, skip_serializing_if = "Option::is_none")]`。
- 触发字段是 `src-tauri/src/commands/publish/preflight/mod.rs` 中的 `PublishOutputAccess.remote_location`。
- `serde` 本身可以解析该属性组合，警告来自 `ts-rs = 9.0.1` 的属性解析器。
- 该结构体派生 `TS`，会参与 `src/generated/tauri-contracts.ts` 契约生成。

## Assumptions

- 目标是消除 warning，不改变 JSON 输出字段语义。
- 不手写修改 `src/generated/tauri-contracts.ts`。

## Requirements

- 保留 `remote_location` 的 `serde(default)` 行为。
- 保留 `remote_location` 为 `None` 时跳过序列化的行为。
- 让 `ts-rs` 不再对该属性输出解析警告。
- 不引入额外逻辑、兜底或行为改动。

## Acceptance Criteria

- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` 通过。
- [ ] 运行契约检查时不再出现该 `serde` 属性解析警告。
- [ ] diff 只包含任务相关变更和 Trellis 任务记录。

## Definition of Done

- Rust 检查通过。
- 前端契约检查通过或说明无法运行的原因。
- 复查 diff，确认没有生成文件手写修改、隐藏 fallback 或无关重构。

## Out of Scope

- 升级 `ts-rs` 或其他依赖。
- 调整发布预检业务逻辑。
- 修改前端 UI 或生成的 TypeScript 契约文件。

## Technical Notes

- 相关规范：`.trellis/spec/frontend/type-safety.md`、`.trellis/spec/frontend/quality-guidelines.md`。
- 跨层点：Rust `Serialize + TS` 派生输出到前端生成契约。
