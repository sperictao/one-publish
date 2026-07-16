# Plan 016: 左栏品牌图标对齐真实应用图标配色，并适配浅色/暗色主题

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat dd4ad2f..HEAD -- src/components/layout/RepositoryList.tsx src/components/layout/__tests__/RepositoryList.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (UI 视觉不一致，用户直接报告)
- **Planned at**: commit `dd4ad2f`, 2026-07-15

## Why this matters

主窗口左栏第一行（面板标题行）显示应用品牌图标 `AppBrandIcon` + "One Publish"
文字。该图标目前用 `fill-primary` 渲染星芒——浅色主题下近黑、暗色主题下近白——
与软件真实图标（任务栏/安装包里的 `src-tauri/icons/icon.svg`：品牌蓝 #3B82F6
星芒 + 琥珀圆心）配色不一致，用户报告"与其它图标不一致"。维护者已选定方向：
**对齐真实应用图标的品牌配色**（蓝色星芒 + 琥珀圆心），且暗色主题下蓝色提亮
一档以保证在深色背景上的可读性。同时该 SVG 复制了 icon.svg 里两条冗余的
`rotate(180)`/`rotate(225)` 矩形（与 0°/45° 完全重叠，因为矩形关于中心点对称），
本次一并删除。

## Current state

相关文件：

- `src/components/layout/RepositoryList.tsx` — 左栏仓库列表；第 92–150 行是内联
  组件 `AppBrandIcon`，第 419–424 行是唯一使用点（面板标题行）。
- `src/components/layout/__tests__/RepositoryList.test.tsx` — 现有单测，
  `describe("RepositoryList", ...)` 从第 138 行开始，用例直接内联渲染
  `<RepositoryList {...props}>`（见第 139–169 行的首个用例）。
- `src-tauri/icons/icon.svg` — 真实应用图标（**只读参照，不改**）：星芒
  `fill="#3B82F6"`（第 22 行），圆心 `fill="#FCD34D"`（第 30 行）。

`AppBrandIcon` 现状（`RepositoryList.tsx:92-150`，节选）：

```tsx
function AppBrandIcon(): ReactNode {
  return (
    <svg width="20" height="20" viewBox="0 0 128 128" fill="none" ...>
      <g transform="translate(64 64) scale(2.3) translate(-18 -18)">
        <g className="fill-primary">
          <rect x="0" y="12" width="36" height="12" rx="6" />
          <rect ... transform="rotate(45 18 18)" />
          <rect ... transform="rotate(90 18 18)" />
          <rect ... transform="rotate(135 18 18)" />
          <rect ... transform="rotate(180 18 18)" />   {/* 与 0° 完全重叠，冗余 */}
          <rect ... transform="rotate(225 18 18)" />   {/* 与 45° 完全重叠，冗余 */}
        </g>
        <circle cx="18" cy="18" r="5" className="fill-warning" />
      </g>
    </svg>
  );
}
```

需要遵守的仓库约定与 token 事实（executor 未读过设计文档，全部内联在此）：

- 主题机制：Tailwind `darkMode: "class"`（`tailwind.config.cjs:6`），
  `useTheme.ts` 在根元素切换 `dark` class。
- 蓝色阶梯 token 按主题重定义（`src/index.css`）：浅色 `--blue-700:
  hsl(215 100% 50%)`（第 58 行）；暗色 `--blue-700: hsl(214 100% 50%)`、
  `--blue-900: hsl(208 100% 64%)`（第 205/207 行）。Tailwind 已把
  `blue.100–1000` 映射进 theme（`tailwind.config.cjs:88-98`），所以
  `fill-blue-700` / `dark:fill-blue-900` 这类工具类可直接使用。
- **"暗色提亮一档"的既有先例**：`--ring` 浅色取 blue-700（`index.css:160`）、
  暗色取 blue-900（`index.css:304`）。本计划对星芒采用同一组合。
- 圆心继续用现有的 `fill-warning`（amber，浅/暗主题分别定义于
  `index.css:159/303`），无需改动。
- **不用**硬编码 `#3B82F6`：它既不是本仓库 token 也不随主题变化；应用内
  "品牌蓝"以 Geist blue 阶梯为准。
- 注意：目前 `src/` 下没有任何 `dark:` Tailwind 变体的用法（主题适配均通过
  CSS 变量完成），本计划的 `dark:fill-blue-900` 是首次引入。这是有意为之
  （单一图标需要跨 step 切换，参照 `--ring` 先例），不要因此改为新增语义
  token —— 那是过度设计。
- 设计合规门禁 `pnpm check:design`（`scripts/check-geist-compliance.mjs`）
  不拦截 `fill-blue-*`（blue 不在 stock-palette 禁用名单，fill- 前缀不在
  扫描规则内），无需加白名单。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Typecheck | `pnpm typecheck` | exit 0 |
| Unit tests | `pnpm test` | 全部通过（当前基线 282+ 用例） |
| 单文件测试 | `pnpm test -- RepositoryList` | 该文件全部通过 |
| Lint | `pnpm lint` | exit 0（存量 warning 允许，不得新增 error） |
| 设计门禁 | `pnpm check:design` | `Geist compliance: OK (...)` |

（依赖已安装则跳过 `pnpm install`。）

## Scope

**In scope**（只允许修改这些文件）：

- `src/components/layout/RepositoryList.tsx`（仅 `AppBrandIcon` 函数体）
- `src/components/layout/__tests__/RepositoryList.test.tsx`（新增一个用例）
- `plans/README.md`（状态行）

**Out of scope**（不要碰，即使看起来相关）：

- `src-tauri/icons/icon.svg` 及全部图标资产 — 真实图标里同样存在的冗余
  rect 属于资产生成流水线（`scripts/generate-icons.mjs`）的范畴，改它需要
  重新生成 png/icns/ico，本计划明确不做（见 Maintenance notes）。
- `src/index.css` / `tailwind.config.cjs` — 现有 token 已够用，禁止新增
  语义 token 或修改阶梯定义。
- `AppBrandIcon` 的尺寸（20px）、viewBox、transform 结构 — 它镜像
  icon.svg 的几何，保持原样便于日后同步。
- `CollapseIcon` 及标题行其它任何元素。

## Git workflow

- 分支：`advisor/016-app-brand-icon-align`（沿用 advisor/NNN-slug 惯例）
- 提交信息：conventional commits + 中文主题，参照
  `dd4ad2f fix(layout): 修复分栏拖拽宽度累加丢失导致的拖不动问题`。
  建议：`fix(ui): 左栏品牌图标对齐应用图标配色并适配双主题`
- 不要 push、不要开 PR。

## Steps

### Step 1: 修改 AppBrandIcon 的配色与冗余几何

在 `src/components/layout/RepositoryList.tsx` 的 `AppBrandIcon` 内：

1. 星芒组 `<g className="fill-primary">` 改为
   `<g className="fill-blue-700 dark:fill-blue-900">`。
2. 删除 `transform="rotate(180 18 18)"` 和 `transform="rotate(225 18 18)"`
   的两个 `<rect>`（保留 0°/45°/90°/135° 四个，视觉 8 臂不变）。
3. `<circle ... className="fill-warning" />` 保持不变。

**Verify**: `pnpm typecheck` → exit 0；
`grep -n "fill-primary\|rotate(180\|rotate(225" src/components/layout/RepositoryList.tsx`
→ 无输出。

### Step 2: 新增回归测试

在 `src/components/layout/__tests__/RepositoryList.test.tsx` 的
`describe("RepositoryList", ...)` 内新增一个用例，复用第 139–169 行首个用例的
props 形状（`createRepository` 等辅助已在文件顶部）。断言：

- 标题行 SVG 的星芒组存在且 class 同时含 `fill-blue-700` 与
  `dark:fill-blue-900`（可用
  `container.querySelector('svg [class*="fill-blue-700"]')` 定位）；
- `container.querySelector('svg .fill-primary')` 为 null；
- 星芒组内 `<rect>` 恰为 4 个；
- 圆心 `circle` 的 class 含 `fill-warning`。

用例名建议：`"品牌图标使用主题化品牌蓝星芒与琥珀圆心"`。

**Verify**: `pnpm test -- RepositoryList` → 全部通过，含新用例。

### Step 3: 全量门禁

**Verify**:
- `pnpm test` → 全部通过；
- `pnpm lint` → exit 0，error 数为 0；
- `pnpm check:design` → `Geist compliance: OK`。

### Step 4:（可选）双主题视觉抽查

仅当环境可运行 GUI 时：`pnpm dev` 启动应用，在设置中切换 浅色/暗色，确认
左栏第一行图标为蓝色星芒（暗色下更亮）+ 琥珀圆心。无 GUI 环境可跳过，
在报告中注明"视觉抽查未执行"。

## Test plan

- 新测试：Step 2 所述单用例，文件
  `src/components/layout/__tests__/RepositoryList.test.tsx`，结构参照同文件
  `139` 行起的 `"点击仓库主按钮会选中对应仓库"`。
- 覆盖点：品牌蓝双主题 class 存在（本计划的核心变更）、`fill-primary`
  回归防护、冗余 rect 不复活。
- 验证：`pnpm test` 全绿。

## Done criteria

全部满足才算完成：

- [ ] `pnpm typecheck` exit 0
- [ ] `pnpm test` 全绿，且新用例存在并通过
- [ ] `pnpm lint` exit 0（0 error）
- [ ] `pnpm check:design` 输出 `Geist compliance: OK`
- [ ] `grep -n "fill-primary" src/components/layout/RepositoryList.tsx` 无输出
- [ ] `git status` 显示改动仅限 In scope 三个文件
- [ ] `plans/README.md` 016 状态行已更新

## STOP conditions

出现以下任一情况，停止并上报，不要自行发挥：

- Drift check 显示 in-scope 文件已变更，且 "Current state" 节选与实际代码
  对不上（尤其 `AppBrandIcon` 已被重构或移出该文件）。
- `fill-blue-700` / `dark:fill-blue-900` 在测试或构建中表现为未生成的工具类
  （说明 Tailwind content/darkMode 配置与本计划记录不符）。
- 任一 Verify 命令在一次合理修复尝试后仍第二次失败。
- 修复似乎需要触碰 Out of scope 文件（例如想改 `tailwind.config.cjs`）。

## Maintenance notes

- **品牌几何单一来源问题（遗留）**：`AppBrandIcon` 手工镜像了
  `src-tauri/icons/icon.svg` 的几何；icon.svg 里同样的冗余
  `rotate(180)`/`rotate(225)` rect 本计划未清理（需要跑图标生成流水线并
  重新产出多尺寸资产）。若日后调整品牌形状，两处需同步，或考虑让
  `scripts/generate-icons.mjs` 从单一 SVG 派生组件。
- **审阅要点**：确认星芒暗色下用的是 blue-900（提亮）而非 blue-700；确认
  没有顺手"美化"标题行其它元素。
- **`dark:` 变体首例**：本仓库此前主题适配全走 CSS 变量。若后续出现更多
  跨 step 的主题切换需求，再考虑抽语义 token；单例不抽。
