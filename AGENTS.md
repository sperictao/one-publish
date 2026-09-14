## Agent skills

### Issue tracker

Issues and specs are tracked in GitHub Issues for `sperictao/one-publish`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five canonical triage labels defined in `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain layout with root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.

### RED boundaries

This project follows RED (see `red.toml`):

- **Document**（已接受知识）：`CONTEXT.md`、`README.md`、`docs/adr/`、`docs/roadmap/`、`docs/agents/`、`docs/release/`、`docs/updater/`、`docs/USER_MANUAL.md`、`docs/design-philosophy.md`、`docs/publish-platform-architecture.md`。未经评审接受，不得把 Research 结论写入 Document。
- **Research**（未验证调研）：`docs/agent/`，文件名以 `R-<n>-` 开头，带 TOML frontmatter。该目录被 `.gitignore` 排除，属本地工作区，不提交。
- **Evolve**（进行中的变更）：新工作走 GitHub Issues/PRs（见上文 Issue tracker），不再新增 `plans/` 文件。`plans/` 是已冻结的历史执行台账（E-1 至 E-35），同样为本地目录，仅供追溯。

变更到达 R/E 边界时，先呈现可评审结果并等待明确接受，再更新 Document。
