# Design — Geist token 体系重建

承接父任务 `design.md` 的契约，本文件聚焦执行细节：文件改动点、token 命名清单、P3 落地形式、useTheme 改造、死代码删除点。

## 1. 文件改动范围

- `src/index.css` — 主要工作量：重写 `:root` 与 `.dark` 的变量定义，新增 step 变量、P3 媒体查询、`@layer components` 组件类、focus ring 工具。
- `tailwind.config.cjs` — `theme.extend.colors`/`fontSize`/`boxShadow` 调整，颜色映射由 `hsl(var(--*))` 改 `var(--*)`。
- `src/hooks/useTheme.ts` — accent 写入改为 step 变量；删除零消费 settings 变量写入。
- `src/components/layout/PublishConfigPanel.tsx`、`src/components/layout/RepositoryList.tsx` — 删除 `scrollbar-fade` 空类引用（死代码清理，最小改动）。

## 2. 颜色变量命名与值来源

所有 step 值从 `design.md`（light）与 `design.dark.md`（dark）的 `colors:` 段直接取。

### 2.1 变量形式

```css
:root {
  /* 灰阶 — HSL（无 P3 变体） */
  --gray-100: hsl(0 0% 95%);
  --gray-1000: hsl(0 0% 9%);
  /* gray-alpha — 半透明，用 hex alpha 或 hsl alpha */
  --gray-alpha-400: hsl(0 0% 0% / 0.08);   /* 等价 #00000014 */
  /* accent — 默认 sRGB hsl */
  --blue-700: hsl(215 100% 50%);
}
@media (color-gamut: p3) {
  :root {
    --blue-700: oklch(57.61% 0.2508 258.23);
    /* 仅 accent step 覆盖 */
  }
}
```

gray-alpha 值：design.md 给的是 hex（`#00000014`），转为 `hsl(0 0% 0% / <alpha>)` 或直接保留 hex。为统一形式，用 `hsl(0 0% 0% / 0.08)` 形式（alpha 由 hex 换算：`14`hex=0.078→0.08，`0d`=0.05，`15`=0.08，`1a`=0.10，`36`=0.21，`3d`=0.24，`70`=0.44，`82`=0.51，`b3`=0.70，`e8`=0.91）。dark 的 gray-alpha 为 `#ffffff**`，即 `hsl(0 0% 100% / <alpha>)`。

### 2.2 语义层映射（重映射后）

见父 design.md §2.2 表。实现为 `:root` 中语义变量直接引用 step 变量：

```css
:root {
  --background: var(--background-100);
  --foreground: var(--gray-1000);
  --card: var(--background-100);
  --primary: var(--gray-1000);
  --secondary: var(--gray-900);          /* 修正 */
  --muted: var(--gray-100);
  --muted-foreground: var(--gray-900);
  --accent: var(--gray-100);
  --destructive: var(--red-700);
  --success: var(--green-700);
  --warning: var(--amber-600);
  --interactive: var(--blue-700);        /* 运行时可改写底层 --blue-700 */
  --border: var(--gray-alpha-400);
  --input: var(--gray-alpha-400);
  --ring: var(--blue-700);
  --background-200: hsl(0 0% 98%);       /* #fafafa */
}
```

dark 主题同理在 `.dark` 覆盖（语义变量指向 dark step 值）。

注：`--background-100` 作为命名常量定义（light `#fff` / dark `#000`），语义层与组件类引用它。

### 2.3 tailwind.config.cjs colors

```js
colors: {
  // 语义层（保留，底层值由 CSS 变量决定）
  background: "var(--background)",
  foreground: "var(--foreground)",
  // ... card/popover/primary/secondary/muted/accent/destructive/success/warning/interactive/border/input/ring
  "background-200": "var(--background-200)",
  // Geist step
  gray: { 100: "var(--gray-100)", 200: "var(--gray-200)", /* ... */ 1000: "var(--gray-1000)" },
  "gray-alpha": { 100: "var(--gray-alpha-100)", /* ... */ 1000: "var(--gray-alpha-1000)" },
  blue: { 100: "var(--blue-100)", /* ... */ 1000: "var(--blue-1000)" },
  red: { /* ... */ }, amber: { /* ... */ }, green: { /* ... */ },
  teal: { /* ... */ }, purple: { /* ... */ }, pink: { /* ... */ },
}
```

`hsl(var(--*))` 全部改为 `var(--*)`。

## 3. Typography token

`theme.extend.fontSize` 新增（对象语法 `[size, { lineHeight, letterSpacing }]`，无 letterSpacing 的省略）：

```js
fontSize: {
  "heading-72": ["72px", { lineHeight: "72px", letterSpacing: "-4.32px" }],
  "heading-64": ["64px", { lineHeight: "64px", letterSpacing: "-3.84px" }],
  // heading-56/48/40/32/24/20/16/14 ...
  "button-16": ["16px", { lineHeight: "20px" }],
  "button-14": ["14px", { lineHeight: "20px" }],
  "button-12": ["12px", { lineHeight: "16px" }],
  "label-20": ["20px", { lineHeight: "32px" }],
  // label-18/16/14/13/12 ...
  "copy-24": ["24px", { lineHeight: "36px" }],
  // copy-20/18/16/14/13 ...
}
```

字重不随 fontSize 绑定（Tailwind fontSize 对象语法不支持 fontWeight），由组件层用 `font-medium`/`font-semibold` 配合。mono 复用同名 size token + `font-mono`（design.md 中 mono 与 sans 同档 metric 一致）。

完整 28 档值清单实施时从 design.md `typography:` 段逐条复制。

## 4. Spacing

父 design.md §4 结论：Geist spacing scale 与 Tailwind 默认兼容，**不新增别名**。本任务仅在规范层记录节奏要求，不改动 `theme.extend.spacing`。半步归并在子任务 2/3 执行。

## 5. Components 类（@layer components）

```css
@layer components {
  .btn-primary {
    @apply h-10 rounded-sm px-2.5 text-button-14 font-medium;
    @apply bg-primary text-primary-foreground;
    /* hover/active: bg-gray-200 / gray-300 — 通过 group 或显式 */
  }
  /* .btn-secondary / .btn-tertiary / .btn-error */
  .btn-small { @apply h-8 rounded-sm px-1.5 text-button-14; }
  .btn-large { @apply h-12 rounded-sm px-3.5 text-button-16 font-medium; }
  .input-base { @apply h-10 rounded-sm px-3 text-label-14; /* + surface-input */ }
  .input-small { @apply h-8; }
  .input-large { @apply h-12 text-label-16; }
}
```

design.md components `padding: 0 10px` → `px-2.5`（10px）；`0 6px`→`px-1.5`；`0 14px`→`px-3.5`；`0 12px`→`px-3`。hover/active step 进阶用 `hover:bg-gray-200 active:bg-gray-300`（primary 的 gray-1000 fill 无 hover step，design.md 指明 primary 不进阶；secondary/tertiary 进阶）。

Button 组件 cva 在子任务 2 改为引用这些类或对齐数值；本任务仅定义类。

## 6. Focus ring 工具

```css
@layer components {
  .focus-ring {
    @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
           focus-visible:ring-offset-2 focus-visible:ring-offset-background;
  }
}
```

全局 `*:focus-visible` 由现有 `outline-2 outline-offset-2` 改为 `outline: none`（避免与组件 ring 叠加），基础组件用 `.focus-ring` 兜底。具体落地在子任务 2；本任务定义工具类与全局规则调整。

## 7. useTheme.ts 改造

现状（调研）：`useTheme.ts:264-271` 写入 `--interactive`/`--interactive-hover`/`--settings-accent`/`--settings-accent-focus`/`--settings-sidebar-selected-bg/text`/`--settings-card-selected-border`。

改造：
- 用户选 accent（blue/purple/pink/red/amber/green/teal 等）时，写入对应 accent scale 的 `--<color>-700`（solid fill）与 `--<color>-800`（hover）、`--ring` 指向 `--<color>-700`。
- `--interactive` 保留为 `var(--<color>-700)` 别名（运行时由 JS 设置 `--interactive` 直接 = 选中色的 700 step 值，或设置 `--interactive: var(--blue-700)` 并改写 `--blue-700`）。选其一：**直接写 `--interactive` 与 `--ring` 为选中色值**最简，无需改写 step 变量。采纳此方案。
- 删除 `--settings-accent*`/`--settings-sidebar-selected-*`/`--settings-card-selected-border` 写入。
- accent 调色板数据（SettingsDialog.tsx:373-381 的 hex）保留（用户可选数据源），但写入逻辑统一到 `--interactive`/`--ring`。

## 8. 死代码删除点（精确）

| 位置 | 内容 | 动作 |
|---|---|---|
| `src/index.css:223-226` | `.config-list-row`/`.config-item-selected` 规则 | 删除 |
| `src/index.css:32` | `--radius: 0.375rem` | 删除（无引用） |
| `src/index.css:50-54` | `--settings-accent`/`-focus`/`-sidebar-selected-bg/text`/`-card-selected-border` | 删除 |
| `src/index.css:59-66` | `--settings-hairline`/`-divider`/`-ink`/`-ink-muted`/`-icon-muted`/`-icon-active`/`-sidebar-item-active`/`-sidebar-item-hover` 别名 | 删除 |
| `useTheme.ts` | 上述 settings 变量的写入逻辑 | 删除 |
| `PublishConfigPanel.tsx:944`、`RepositoryList.tsx:326` | `scrollbar-fade` 类引用 | 删除引用 |
| `tailwind.config.cjs` | `shadow-popover`/`shadow-modal`/`shadow-inset` 工具（零使用） | 删除（功能由 `.surface-*` CSS 类承担）；`animate-slide-up` + `slideUp` keyframes（零使用）删除 |
| `--interactive-foreground` | 零消费 | 删除变量与 `interactive.foreground` 映射 |

保留：`.surface-raised`/`.surface-popover`/`.surface-modal`/`.surface-input`/`.status-*`/`.list-scroll-shell`/`.geist-scrollbar` CSS 类（有消费）；`shadow-raised`（有使用）；`animate-fade-in`（有使用）。

## 9. 风险与回滚

- **`var(--*)` 形式升级**：所有 `hsl(var(--*))` 改 `var(--*)` 后，若遗漏某处变量值未携带 color 函数（如仍写 `0 0% 9%`），该色将失效。需逐变量核对值携带 `hsl(...)`/`oklch(...)`。
- **`--secondary` 修正**：破坏性，调研显示 `bg-secondary` 使用极少，实施时 grep 全部 `secondary` 调用点核对。
- **P3 媒体查询**：仅在支持 `color-gamut: p3` 的屏幕生效，sRGB 屏幕回退到 HSL，无风险。
- 回滚：本任务改动集中于 3 文件 + 2 处类引用删除，git revert 即可。
