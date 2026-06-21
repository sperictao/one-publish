# Design — Geist UI 基础组件对齐

承接父任务 `design.md` 与子任务 1 落地的 token 体系，本文件定义 16 个 `components/ui/**` 组件的 token 映射原则与关键决策。实施时以 design.md / design.dark.md 为最终准绳。

## 1. 映射原则

- **字号**：手写 `text-sm`/`text-xs`/`text-lg`/`text-[Npx]` 全部替换为 typography fontSize token（`text-heading-*`/`text-label-*`/`text-copy-*`/`text-button-*`）。选档以 design.md 语义为准（标题→heading，单行标签/元数据→label，正文→copy，按钮→button）。
- **字重**：用 `font-medium`/`font-semibold`/`font-normal` 配合 size token（fontSize 对象语法不绑定 weight）。`font-bold`（若有）→ `font-semibold`。
- **颜色**：保留现有语义类（`bg-primary`/`text-muted-foreground` 等，底层已是 Geist step）。硬编码色（`bg-black/50` overlay、`text-white`）按 §3 决策处理。
- **圆角/尺寸**：已对齐 Geist radii（sm=6/md=12/lg=16），保留。组件 height/padding 对齐 design.md `components:` token（§4）。
- **focus ring**：所有可聚焦组件统一用 `.focus-ring` 工具类替代散落的 `focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`。
- **API 不变**：`variant`/`size`/`className` 等 prop 签名不变，仅替换内部 className。

## 2. 字号档位决策表

| 场景 | 原 className | 新 token | 依据 |
|---|---|---|---|
| Dialog/Card/AppDialog 标题 | `text-[18px] font-semibold` / `text-lg font-semibold` | `text-heading-20 font-semibold` | 标题语义，对齐 heading 档（18px 非标准档，取最近标题档 20px，接受微调） |
| 区块小标题（section-shell 标题） | `text-sm font-semibold` | `text-heading-14 font-semibold` | 小标题，heading-14 |
| 正文/描述 | `text-sm text-muted-foreground` | `text-copy-14 text-muted-foreground` | 正文，copy-14 |
| 表单 label | `text-sm font-semibold`（Label 组件） | `text-label-14 font-semibold` | 单行标签 |
| 按钮 | `text-sm font-medium`（Button） | `text-button-14 font-medium` | 按钮 |
| 菜单项（DropdownMenuItem） | `text-xs` | `text-label-13` | 菜单条目，label-13（12px 偏小，13px 可读） |
| SelectItem/SelectLabel | `text-sm` / `text-sm font-semibold` | `text-label-14` / `text-label-14 font-semibold` | 标签 |
| Tooltip | `text-sm` | `text-label-14` | 标签 |
| 极小徽章/eyebrow（section badge `text-[10px]`、app-dialog-badge `text-[11px]`） | `text-[10px]`/`text-[11px]` | `text-label-12` | design 最小 label 档 12px；10/11px 低于 design 下限，统一到 12px |
| section-shell 描述 | `text-[11px] leading-4 text-[hsl(var(--text-fine))]` | `text-label-12 text-[hsl(var(--text-fine))]` | 保留 `--text-fine` 消费（raw triplet，刻意），字号统一 12px |
| CardTitle | `text-[18px] font-semibold leading-none` | `text-heading-20 font-semibold` | 标题档（leading 由 token 给 26px，去 leading-none） |

注：`leading-none`/`leading-[1.4]` 等手写行高删除，由 token 的 lineHeight 承载。

## 3. 硬编码色决策

- **Dialog overlay `bg-black/50`**：保留。遮罩用纯黑半透明是标准做法，design.md 未定义 overlay token；`black` 是 Tailwind 内置色，alpha 修饰符有效。不视为魔数。
- **`.btn-error` 的 `text-white` / `bg-red-800`**：`bg-red-800` 是 step token（`var(--red-800)`，P3 生效）；`text-white` 保留（红底白字，design.md error button 规定 `#ffffff`）。
- **`text-[hsl(var(--text-fine))]`**（section-shell）：保留 raw 形式（`--text-fine` 是 raw triplet，刻意用于 ≤12px 次级文字）。仅改字号到 token。
- **switch thumb `bg-background`**：保留语义类。

## 4. Button / Input 对齐 components token

`Button` cva（`button.tsx`）数值对齐 design.md `components:`：

- default size：`h-10 px-4 py-2` → `h-10 px-2.5`（design `padding: 0 10px` = px-2.5；去掉 py，height 已定）。`text-sm font-medium` → `text-button-14 font-medium`。
- sm size：`h-8 px-1.5` ✓（design small `0 6px`）。加 `text-button-14`。
- lg size：`h-12 px-3.5` ✓（design large `0 14px`）。`text-button-16 font-medium`。
- icon size：`size-10 rounded-full` 保留。
- variant 填色保留语义类（`bg-primary text-primary-foreground` 等），对齐 design.md primary/secondary/tertiary/error 语义。
- focus：基础串的 `focus-visible:ring-2 ...` 替换为 `.focus-ring`。

`Input`/`Textarea`/`SelectTrigger`：`surface-input ... h-10 rounded-sm px-3 text-sm` → `surface-input ... h-10 rounded-sm px-3 text-label-14`（design input `padding: 0 12px` = px-3 ✓）。focus 由 `.surface-input:focus-within` 承担（已有），额外加 `.focus-ring` 兜底或保留现有。

## 5. 组件清单与重点

| 组件 | 重点 |
|---|---|
| button.tsx | cva 数值对齐 components token + `.focus-ring` + text-button-* |
| input.tsx | text-label-14 |
| textarea.tsx | text-label-14 |
| card.tsx | CardTitle text-heading-20, CardDescription text-copy-14, p-6 保留 |
| dialog.tsx | overlay 保留 bg-black/50, DialogTitle text-heading-20, DialogDescription text-copy-14, Close 按钮 .focus-ring |
| select.tsx | trigger text-label-14, content rounded-md 保留, item text-label-14, label text-label-14 font-semibold |
| dropdown-menu.tsx | item text-xs→text-label-13, .focus-ring |
| switch.tsx | .focus-ring, 尺寸保留 |
| label.tsx | text-label-14 font-semibold |
| tooltip.tsx | text-label-14 |
| sonner.tsx | classNames 注入保留语义类（无需改 token） |
| section-shell.tsx | 标题 text-heading-14, 描述 text-label-12 + 保留 --text-fine, badge text-label-12, 图标徽保留 |
| app-dialog-shell.tsx | title text-heading-20, 图标 h-10 w-10 rounded-md 保留, 其余间距保留 |
| app-dialog-badge.tsx | text-[11px]→text-label-12 |
| app-dialog-inset.tsx | rounded-md 保留, 无字号魔数 |
| help-tip.tsx | size-4 rounded-full 保留, .focus-ring |

## 6. 不做

- 不改业务组件（layout/publish/...）——子任务 3。
- 不改组件 API。
- 不动 `--theme-preview-*`、`--terminal-*`。
- 不引入新依赖。

## 7. 验证

- `pnpm typecheck && pnpm test` 全绿。
- grep：`rg "text-\[|text-lg|text-xs|text-sm" src/components/ui/` 应无手写魔数残留（`text-white`/`text-black` 等标准色除外；`text-sm` 在 sonner 等若无法替换可保留并注明）。
- 测试锚点保留（ui 组件无测试锚定的 className 字面量，但 `[overflow-wrap:anywhere]` 在 PublishRunCard 属子任务 3）。
- 视觉：light/dark 下基础组件与 design.md 一致。
