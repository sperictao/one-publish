# 初始化任务：填充项目开发规范

**本任务面向执行 Trellis 初始化的 AI 助手。开发者不需要直接阅读此文件。**

本项目首次运行 `trellis init` 后，`.trellis/` 已生成空的 spec 脚手架，
初始化任务位于 `.trellis/tasks/00-bootstrap-guidelines/`。当团队需要补齐
项目规范时，应从带有 Trellis 会话身份的会话启动并执行本任务。

**任务目标**：把团队真实的编码约定写入 `.trellis/spec/`。后续每个 AI 开发任务
都会通过 `implement.jsonl` / `check.jsonl` 自动加载相关 spec 文件。如果 spec 为空，
子智能体容易写出泛化代码；如果 spec 记录了当前仓库的真实模式，后续实现和检查就能
贴合 OnePublish 的现有边界。

不要只转述模板说明。执行时应先查找仓库内已有约定文档，例如 `AGENTS.md`、
`.cursorrules`、`CONTRIBUTING.md`，再结合真实代码路径补齐规范。

---

## 状态

- [x] 填充前端规范
- [x] 补充真实代码参考示例

---

## 需要填充的 spec 文件


### 前端规范

| 文件 | 需要记录的内容 |
|------|------------------|
| `.trellis/spec/frontend/directory-structure.md` | 组件、页面、hook、工具和测试的组织方式 |
| `.trellis/spec/frontend/component-guidelines.md` | 组件结构、props、组合方式、样式与可访问性 |
| `.trellis/spec/frontend/hook-guidelines.md` | 自定义 hook 命名、接口、副作用和拆分模式 |
| `.trellis/spec/frontend/state-management.md` | 当前状态来源、owner、持久化和 scope 规则 |
| `.trellis/spec/frontend/type-safety.md` | TypeScript 约束、类型来源、normalization 与断言边界 |
| `.trellis/spec/frontend/quality-guidelines.md` | 质量检查、测试分层、评审重点和禁用模式 |


### 思考指南

`.trellis/spec/guides/` 下是通用思考指南，已预填基础内容。只有当其中规则明显不适合
OnePublish 时才需要定制。

---

## 填充方式

### 步骤 1：优先导入已有约定文档

先搜索仓库内已有规范文档。若存在，应读取并把相关规则整理到对应的
`.trellis/spec/` 文件中，避免从零编写导致遗漏真实约定。

| 文件 / 目录 | 常见来源 |
|------|------|
| `CLAUDE.md` / `CLAUDE.local.md` | Claude Code |
| `AGENTS.md` | Codex / Claude Code / 兼容智能体的工具 |
| `.cursorrules` | Cursor |
| `.cursor/rules/*.mdc` | Cursor 规则目录 |
| `.windsurfrules` | Windsurf |
| `.clinerules` | Cline |
| `.roomodes` | Roo Code |
| `.github/copilot-instructions.md` | GitHub Copilot |
| `.vscode/settings.json` → `github.copilot.chat.codeGeneration.instructions` | VS Code Copilot |
| `CONVENTIONS.md` / `.aider.conf.yml` | aider |
| `CONTRIBUTING.md` | 通用项目约定 |
| `.editorconfig` | 编辑器格式规则 |

### 步骤 2：用真实代码补齐未覆盖内容

扫描当前代码库来识别真实模式。写每个 spec 文件前：

- 为每类模式找到 2-3 个当前存在的参考路径。
- 只引用真实文件路径，不写假想路径。
- 记录团队已经明确避免的反模式。

### 步骤 3：记录现实，不写理想化规范

**关键要求**：写当前代码实际采用的做法，而不是“应该如何”。子智能体会按 spec
实现和评审；如果 spec 写成未落地的理想规范，后续代码会显得不贴合当前项目。

如果存在已知技术债，应记录当前状态。是否重构是后续任务，不属于初始化
规范填充的范围。

---

## 运行机制说明

- 每个 AI 开发任务通常会经过 `trellis-implement` 和 `trellis-check` 两类子智能体。
- 每个任务通过 `implement.jsonl` / `check.jsonl` 声明需要加载哪些 spec 文件。
- 平台 hook 会把这些 spec 文件和任务 `prd.md` 注入子智能体上下文。
- `.trellis/spec/` 是后续实现和评审的长期规范来源，因此初始化阶段必须写真实内容。

---

## 完成标准

当开发者确认上述检查项已用真实示例完成，且没有模板占位内容后，引导他们运行：

```bash
python3 ./.trellis/scripts/task.py finish
python3 ./.trellis/scripts/task.py archive 00-bootstrap-guidelines
```

归档后，新加入项目的开发者会收到 `00-join-<slug>` 入门任务，而不是这个
初始化任务。

---

## 建议开场

“我会帮你完成 Trellis 的一次性项目规范初始化，让后续 AI 开发任务遵循本仓库真实约定。
我会先读取已有约定文档，再扫描代码补齐 `.trellis/spec/`。”
