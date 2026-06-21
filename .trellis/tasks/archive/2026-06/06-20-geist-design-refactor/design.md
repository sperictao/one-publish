# Design — Geist 设计系统全量对齐

本文件定义跨子任务的技术契约：token 命名规范、P3 策略、focus ring 统一方案、以及子任务间的接口。各子任务的技术细节在各自 `design.md` 中展开。

## 1. 设计原则

- **语义层 = Geist token 的别名，而非独立桶**：保留 shadcn 语义类名（`bg-background`/`border`/`text-muted-foreground` 等），但其底层 CSS 变量重映射到 Geist step。语义类是合理的语义抽象（调用点零改动），Geist step token 是底层真理源。
- **step token 直接可用**：同时暴露 `gray-100~1000`、`gray-alpha-100~1000`、各 accent 10 步，供需要精确 step 的场景（状态色、徽章、图标着色）直接使用。
- **typography 由 token 驱动**：消除手写 `text-[Npx]`/`tracking-[...]`，统一用 Tailwind fontSize 命名 token。
- **严格兼容性**：不保留 legacy 桶作 fallback；零消费变量与死规则直接删除。

## 2. 颜色 Token 契约

### 2.1 CSS 变量形式升级（为支持 P3）

现有 `hsl(var(--background))` 形式无法承载 oklch P3 值。统一升级为：

```css
:root {
  --gray-1000: hsl(0 0% 9%);          /* 灰阶：HSL 即可，无 P3 变体 */
  --blue-700: hsl(215 100% 50%);       /* accent：默认 sRGB */
}
@media (color-gamut: p3) {
  :root {
    --blue-700: oklch(57.61% 0.2508 258.23);  /* P3 屏幕覆盖为宽色域 */
  }
}
```

Tailwind config 由 `hsl(var(--*))` 改为 `var(--*)`，变量值本身携带完整 color 函数。这样同一变量在 sRGB/P3 屏幕自动切换，调用点无感知。

### 2.2 灰阶与语义层映射

`src/index.css` `:root`（light）与 `.dark`（dark）定义全部 Geist step 变量，值取自 design.md/design.dark.md：

| 语义类 (Tailwind) | 底层变量 | light = | dark = |
|---|---|---|---|
| `background` | `--background` | `background-100` (#fff) | `background-100` (#000) |
| `card` / `popover` | `--card` / `--popover` | `background-100` | `gray-100` (#1a1a1a) |
| `foreground` | `--foreground` | `gray-1000` | `gray-1000` (#ededed) |
| `primary` | `--primary` | `gray-1000` | `gray-1000` |
| `secondary` | `--secondary` | **`gray-900`**（修正重载，原为 gray-100） | `gray-900` |
| `muted` | `--muted` | `gray-100` | `gray-200` |
| `muted-foreground` | `--muted-foreground` | `gray-900` | `gray-900` |
| `accent` | `--accent` | `gray-100` | `gray-300` |
| `destructive` | `--destructive` | `red-700` | `red-600` |
| `success` | `--success` | `green-700` | `green-600` |
| `warning` | `--warning` | `amber-600` | `amber-600` |
| `interactive` | `--interactive` | `blue-700`（运行时可改写） | `blue-700` |
| `border` | `--border` | `gray-alpha-400` | `gray-alpha-400` |
| `input` | `--input` | `gray-alpha-400` | `gray-alpha-400` |
| `ring` | `--ring` | `blue-700` | `blue-900` |

新增 `--background-200`（light `#fafafa` / dark `#0a0a0a`）作为次级表面 token，并暴露为 Tailwind `background-200`。

**`--secondary` 修正**：原重载为 `gray-100`（light），现修正为 DESIGN.md 的 `gray-900`。这是破坏性变更，需排查所有 `bg-secondary`/`text-secondary-foreground` 调用点（调研显示使用极少），统一迁移到正确语义或改用 `muted`。

### 2.3 step token 暴露

`tailwind.config.cjs` `theme.extend.colors` 新增：

```js
gray: { 100: "var(--gray-100)", /* ... */ 1000: "var(--gray-1000)" },
"gray-alpha": { 100: "var(--gray-alpha-100)", /* ... */ },
blue: { 100: "var(--blue-100)", /* ... */ },
// red / amber / green / teal / purple / pink 同理
```

调用点可直接 `bg-gray-700`/`text-blue-700`/`border-gray-alpha-400`。

### 2.4 运行时 accent（useTheme.ts）

保留 `useTheme.ts` 的 accent 写入机制，但改为写 step 变量：用户选 accent 时写入 `--blue-700`（及 hover `--blue-800`、focus `--ring`）等。`--interactive` 保留为 `--blue-700` 的别名（`--interactive: var(--blue-700)`），语义类继续通过 `--interactive` 消费。删除零消费的 `--settings-accent`/`--settings-sidebar-selected-*`/`--settings-card-selected-border` 等变量及其写入逻辑。

## 3. Typography Token 契约

`tailwind.config.cjs` `theme.extend.fontSize` 用对象语法定义命名 token，每个携带 lineHeight 与 letterSpacing：

```js
fontSize: {
  "heading-16": ["16px", { lineHeight: "24px", letterSpacing: "-0.32px" }],
  "heading-14": ["14px", { lineHeight: "20px", letterSpacing: "-0.28px" }],
  "label-14":   ["14px", { lineHeight: "20px" }],
  "copy-14":    ["14px", { lineHeight: "20px" }],
  "button-14":  ["14px", { lineHeight: "20px", fontWeight: "500" }],
  // ... heading-72~14, button-16/14/12, label-20~12, copy-24~13
}
```

调用点用 `text-heading-16`/`text-copy-14`/`text-label-14`/`text-button-14`。字重用 `font-semibold`/`font-medium`/`font-normal` 配合（或随 token 约定）。mono 变体通过 `font-mono` + 对应 size token 组合（如 `font-mono text-label-14-mono`，其中 mono size token 仅在 letterSpacing/lineHeight 与 sans 不同时单独定义；DESIGN.md 中 mono 与 sans 同档 metric 一致，故 mono 复用同名 size token + `font-mono`）。

`fontWeight` 扩展：DESIGN.md 仅用 400/500/600，映射 `font-normal`/`font-medium`/`font-semibold`，删除业务组件中的 `font-bold`（14 处）改 `font-semibold`。

## 4. Spacing Token 契约

`tailwind.config.cjs` `theme.extend.spacing` 新增 Geist scale 别名（不覆盖默认，以别名共存）：

```js
spacing: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px", 10: "40px", 16: "64px", 24: "96px" }
```

注：Tailwind 默认 spacing 的 `1=4px/2=8px/4=16px` 与 Geist 一致；`3` 默认是 12px 也一致；`6=24px` 一致；`8=32px` 一致。Geist 额外有 `10=40px/16=64px/24=96px`，默认 scale 的 `10=40px/16=64px/24=96px` 也已存在。故 Geist spacing scale 与 Tailwind 默认完全兼容，**无需新增别名**——只需在规范层要求使用 Geist 节奏（8/16/32），避免 `1.5/2.5/3.5` 等半步。半步（`gap-1.5`/`p-2.5`）在调研中出现频繁，重构时按场景归并到最近 Geist 步长。

## 5. Components Token 契约

`src/index.css` 新增组件类（或 `@layer components`），对齐 DESIGN.md components token：

- `.btn-primary` / `.btn-secondary` / `.btn-tertiary` / `.btn-error`：height 40px、radius sm(6px)、padding、对应填色与文字色、hover/active step 进阶。
- `.btn-small` (32px) / `.btn-large` (48px)。
- `.input-base` / `.input-small` / `.input-large`。

`Button` 组件（cva）variant/size 改为引用这些约定值（通过 className 或直接对齐数值），消除 `h-10 px-4 py-2` 等与 DESIGN.md `padding: 0 10px` 不一致的硬编码。

## 6. Focus Ring 统一

现状冲突：全局 `*:focus-visible { outline-2 outline-offset-2 }`（index.css:158）与组件 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`（shadcn 模板）双层叠加。

**统一方案**：采用 DESIGN.md 双层 ring（2px surface gap + 2px blue ring），通过组件级 `focus-visible:ring` 实现；移除全局 `*:focus-visible` outline 规则，改为全局 `*:focus-visible { outline: none }` 仅在组件未自定义时由基础组件兜底。具体：基础组件（Button/Input/Select/Switch 等）统一 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`；非组件原生元素（div/button 自定义）由 `:focus-visible` 全局兜底 ring。

此方案在子任务 1（token）定义工具，子任务 2（ui）落地到组件。

## 7. 死代码清理清单（子任务 1 执行）

- `src/index.css:223-226` `.config-list-row`/`.config-item-selected` 规则（零挂载）。
- `scrollbar-fade` 类引用（`PublishConfigPanel.tsx:944`、`RepositoryList.tsx:326`）——空操作类，删除引用。
- `--settings-hairline`/`--settings-divider`/`--settings-ink`/`--settings-ink-muted`/`--settings-icon-muted`/`--settings-icon-active`/`--settings-sidebar-item-active`/`--settings-sidebar-item-hover`（index.css:59-66，零消费别名）。
- `--settings-accent`/`--settings-accent-focus`/`--settings-sidebar-selected-bg`/`--settings-sidebar-selected-text`/`--settings-card-selected-border`（index.css:50-54，零消费）及 `useTheme.ts` 对应写入逻辑。
- `--interactive-foreground` 若确认零消费则删除（调研未发现调用）。
- `--radius: 0.375rem`（index.css:32）shadcn 遗留变量，无 className 引用。
- `animate-slide-up`（零使用）与 `shadow-popover`/`shadow-modal`/`shadow-inset` Tailwind 工具（零使用，功能由 `.surface-*` CSS 类承担）——保留 `.surface-*` 类，删除未用的 Tailwind boxShadow 工具或将其接通；二选一在子任务 1 design 定夺。

## 8. 测试锚点保留清单（全子任务遵守）

重构不得破坏以下（详见 prd.md Constraints）。子任务实施时 grep 校验：

- CSS 类：`.list-scroll-shell`、`.repo-list-grid`、`.geist-scrollbar`
- className 字面量：`[overflow-wrap:anywhere]`、`pl-3`、`pl-10`
- data 属性：`data-list-item-id`、`data-list-row`、`data-list-visual-target`、`data-list-menu-open`、`data-selected`、上述 `data-testid`
- ARIA name 与可见文案

## 9. 跨子任务接口

- **子任务 1 → 2/3**：交付 `tailwind.config.cjs` + `src/index.css` + `useTheme.ts`，暴露全部 token（语义类重映射 + step token + typography fontSize token + components 类 + focus ring 工具）。子任务 2/3 只能消费已定义 token。
- **子任务 2 → 3**：交付对齐后的 `components/ui/**`，业务组件引用的 UI 基础组件 API 不变（仅视觉）。
- **子任务 3 → 4**：交付全部业务组件重构。
- **子任务 4**：全量门禁，grep 校验无魔数残留 + typecheck/test/doctor/e2e 全绿 + 视觉回归。

## 10. 回滚

- 每个子任务独立 commit（由用户触发），任一子任务失败可回滚到上一子任务边界。
- token 体系（子任务 1）是基础，若其验收失败，2/3 不启动。
