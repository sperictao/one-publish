# Apple Liquid Glass Design System

OnePublish 的视觉设计系统，灵感来源于 Apple WWDC25 Liquid Glass 设计语言。

本文档涵盖设计令牌（Design Tokens）、玻璃态工具类、动效系统及组件应用映射。

---

## 目录

1. [设计理念](#设计理念)
2. [设计令牌 — CSS 变量](#设计令牌--css-变量)
3. [玻璃态工具类](#玻璃态工具类)
4. [动效系统](#动效系统)
5. [组件应用映射](#组件应用映射)
6. [无障碍与性能](#无障碍与性能)
7. [使用指南](#使用指南)

---

## 设计理念

### 核心原则

| 原则 | 说明 |
|------|------|
| **深度感** | 通过 `backdrop-blur` + `saturate` 模拟真实玻璃折射，创造层次感 |
| **光泽反射** | `::before` 伪元素叠加 specular highlight 渐变，模拟光线在玻璃表面的反射 |
| **触觉反馈** | 按压时 `scale(0.97)` 配合弹簧曲线，模拟物理按钮的触感 |
| **流体运动** | 所有状态变化使用 Apple 风格弹簧物理曲线，而非线性或 ease-in-out |
| **环境融合** | 半透明背景让底层内容隐约可见，UI 与环境融为一体 |

### 与 Apple 设计语言的对应

| Apple 概念 | OnePublish 实现 |
|-----------|----------------|
| Liquid Glass Material | `.glass-panel` / `.glass-surface` / `.glass-card` |
| Specular Highlight | `::before` + `var(--glass-specular)` |
| Spring Animation | `cubic-bezier(0.34, 1.56, 0.64, 1)` |
| Haptic Feedback | `.glass-press` — `active:scale(0.97)` |
| Depth Through Motion | `.glass-hover-lift` — `hover:translateY(-1px)` |
| Staggered Entrance | `.glass-stagger` — 30ms 递增延迟 |

---

## 设计令牌 — CSS 变量

所有变量定义在 `src/index.css` 中，分为亮色/暗色两套。

### 背景与表面

| 变量 | 亮色值 | 暗色值 | 用途 |
|------|--------|--------|------|
| `--glass-bg` | `rgba(255,255,255,0.62)` | `rgba(255,255,255,0.08)` | 交互元素默认背景 |
| `--glass-bg-hover` | `rgba(255,255,255,0.72)` | `rgba(255,255,255,0.12)` | hover 状态背景 |
| `--glass-bg-active` | `rgba(255,255,255,0.82)` | `rgba(255,255,255,0.16)` | active/selected 状态背景 |
| `--glass-panel-bg` | `rgba(245,245,247,0.78)` | `rgba(30,30,35,0.82)` | 面板/卡片容器背景 |
| `--glass-input-bg` | `rgba(0,0,0,0.05)` | `rgba(255,255,255,0.06)` | 输入框/表单背景 |
| `--glass-overlay` | `rgba(0,0,0,0.18)` | `rgba(0,0,0,0.45)` | Dialog 遮罩层 |
| `--glass-code-bg` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.08)` | 代码块背景 |

### 边框与分割线

| 变量 | 亮色值 | 暗色值 | 用途 |
|------|--------|--------|------|
| `--glass-border` | `rgba(0,0,0,0.12)` | `rgba(255,255,255,0.18)` | 主要边框 |
| `--glass-border-subtle` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.1)` | 次要/微妙边框 |
| `--glass-divider` | `rgba(0,0,0,0.1)` | `rgba(255,255,255,0.1)` | 分割线 |
| `--glass-kbd-border` | `rgba(0,0,0,0.12)` | `rgba(255,255,255,0.15)` | 键盘快捷键标签边框 |

### 阴影

| 变量 | 亮色值 | 暗色值 | 用途 |
|------|--------|--------|------|
| `--glass-shadow` | `0 2px 16px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.12)` | `0 2px 16px rgba(0,0,0,0.25), 0 0 1px rgba(255,255,255,0.06)` | 标准阴影 |
| `--glass-shadow-lg` | `0 8px 32px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.15)` | `0 8px 32px rgba(0,0,0,0.35), 0 0 1px rgba(255,255,255,0.1)` | 大阴影（hover 提升） |
| `--glass-shadow-selected` | `0 4px 24px rgba(0,0,0,0.1), inset 0 0 0 1px rgba(0,0,0,0.08)` | `0 4px 24px rgba(0,0,0,0.3), inset 0 0 0 1px rgba(255,255,255,0.12)` | 选中状态阴影 |
| `--glass-inset-shadow` | `inset 0 1px 3px rgba(0,0,0,0.06)` | `inset 0 1px 3px rgba(0,0,0,0.2)` | 输入框内凹阴影 |

### 光泽

| 变量 | 亮色值 | 暗色值 | 用途 |
|------|--------|--------|------|
| `--glass-specular` | `linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.05) 50%, transparent 100%)` | `linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.02) 50%, transparent 100%)` | 表面高光反射 |

### 键盘标签

| 变量 | 亮色值 | 暗色值 | 用途 |
|------|--------|--------|------|
| `--glass-kbd-bg` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.1)` | `<kbd>` 背景 |

---

## 玻璃态工具类

定义在 `src/index.css` 中，可直接作为 className 使用。

### `.glass-panel`

面板级容器，最高模糊度。

```css
background: var(--glass-panel-bg);
backdrop-filter: blur(40px) saturate(180%);
```

**使用场景**：CollapsiblePanel、主布局面板。

### `.glass-surface`

交互元素容器，带 specular 高光。

```css
background: var(--glass-bg);
backdrop-filter: blur(20px) saturate(150%);
border: 1px solid var(--glass-border);
box-shadow: var(--glass-shadow);
/* ::before 伪元素叠加 var(--glass-specular) */
```

**使用场景**：SettingsDialog 侧边栏、独立交互区域。

### `.glass-surface-selected`

选中状态的 surface，更高饱和度和内发光。

```css
background: var(--glass-bg-active);
backdrop-filter: blur(24px) saturate(180%);
box-shadow: var(--glass-shadow-selected);
```

**使用场景**：BranchPanel 当前分支、ReleaseChecklist 当前步骤。

### `.glass-card`

卡片容器，带微妙 specular 高光。

```css
background: var(--glass-panel-bg);
backdrop-filter: blur(24px) saturate(160%);
border: 1px solid var(--glass-border);
box-shadow: var(--glass-shadow);
/* ::before 伪元素叠加弱化版高光 */
```

**使用场景**：Card 组件基础样式。

### `.glass-input`

输入框容器，带内凹阴影和聚焦动效。

```css
background: var(--glass-input-bg);
backdrop-filter: blur(8px);
border: 1px solid var(--glass-border-subtle);
box-shadow: var(--glass-inset-shadow);
/* :focus-within 时扩展为 primary 色 ring */
```

**使用场景**：BranchPanel 搜索框包裹层。

### `.glass-divider`

替代硬边框的分割线。

```css
border-color: var(--glass-divider);
```

**使用场景**：面板间分割、列表项分隔。

---

## 动效系统

定义在 `src/index.css` 和 `tailwind.config.cjs` 中。

### 弹簧物理曲线

Apple 的动效核心是基于物理的弹簧曲线，而非传统 CSS easing。

| 曲线名称 | cubic-bezier 值 | 适用场景 |
|---------|----------------|---------|
| **Standard Spring** | `0.34, 1.56, 0.64, 1` | 位移、缩放（带轻微过冲） |
| **Smooth Ease** | `0.2, 0.8, 0.2, 1` | 透明度、颜色、背景（无过冲） |
| **Apple Bounce** | `0.34, 1.3, 0.64, 1` | 弹跳效果 |

在 Tailwind 中可通过 `ease-apple-spring`、`ease-apple-ease`、`ease-apple-bounce` 使用。

### `.glass-press` — 触觉按压反馈

模拟物理按钮的按压感。元素在 `:active` 时缩小，释放后弹回。

```css
transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
:active { transform: scale(0.97); transition-duration: 0.1s; }
```

**应用组件**：Button、Switch、Select trigger、Dialog close、Settings 导航项、Checklist 步骤按钮。

### `.glass-hover-lift` — 悬浮上升

元素在 hover 时向上浮起 1px 并增大阴影，创造"靠近用户"的深度感。

```css
transition: transform 0.35s spring, box-shadow 0.35s ease;
:hover { transform: translateY(-1px); box-shadow: var(--glass-shadow-lg); }
:active { transform: translateY(0) scale(0.98); }
```

**应用组件**：独立使用较少，通常通过 `.glass-interactive` 组合使用。

### `.glass-interactive` — 组合交互

hover-lift + press-scale 的组合，适用于可点击的卡片和容器。

```css
:hover { transform: translateY(-1px); box-shadow: var(--glass-shadow-lg); }
:active { transform: translateY(0) scale(0.97); transition-duration: 0.1s; }
```

**应用组件**：Card 组件。

### `.glass-shimmer-hover` — 光泽扫过

hover 时一道高光从左到右扫过元素表面，模拟光线在玻璃上的移动。

```css
::after {
  background: linear-gradient(105deg, transparent 40%, white/0.25 50%, transparent 60%);
  background-size: 200% 100%;
  /* hover 时 background-position 从 200% 滑动到 -200% */
}
```

**应用组件**：可选用于特殊强调元素（如 CTA 按钮）。

### `.glass-stagger` — 列表交错入场

子元素依次延迟入场，每项间隔 30ms，最多 8 级延迟。

```css
> * { animation: stagger-fade-in 0.35s ease both; }
> *:nth-child(1) { animation-delay: 0ms; }
> *:nth-child(2) { animation-delay: 30ms; }
/* ... 递增至 nth-child(n+9): 240ms */
```

**入场动画**：从 `opacity: 0; translateY(6px)` 到 `opacity: 1; translateY(0)`。

**应用组件**：BranchPanel 分支列表、ShortcutsDialog 快捷键列表、ReleaseChecklist 步骤列表。

### `.glass-transition` — 平滑状态过渡

为 color、background-color、border-color、box-shadow、opacity 统一添加 0.2s 弹簧过渡。

```css
transition: color 0.2s ease, background-color 0.2s ease,
            border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
```

**应用组件**：Select item、BranchPanel 列表项、Settings 快捷键行、ResizeHandle。

### `.glass-focus-ring` — 焦点环动画

焦点环从 0px 弹簧扩展到 3px，带 primary 色光晕。

```css
:focus-visible {
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15);
  animation: glass-focus-pulse 0.3s spring;
}
```

### `.glass-scrollbar` — 自动隐藏滚动条

Apple 风格：滚动条默认透明，hover 时渐显。

```css
scrollbar-color: transparent transparent;
:hover { scrollbar-color: muted/0.3 transparent; }
```

**应用组件**：App 主内容区、BranchPanel、SettingsDialog、EnvironmentCheckDialog、ReleaseChecklistDialog、RepositoryList。

---

## 组件应用映射

### shadcn/ui 基础组件

| 组件 | 文件 | 玻璃态类 | 动效类 | 说明 |
|------|------|---------|--------|------|
| **Button** | `ui/button.tsx` | `shadow-[var(--glass-shadow)]`, `border-[var(--glass-border)]`, `bg-[var(--glass-bg)]`, `backdrop-blur-sm` | `glass-press` | 所有变体均有按压反馈；outline/secondary 带玻璃边框和模糊 |
| **Card** | `ui/card.tsx` | `glass-card` | `glass-interactive` | hover 上浮 + 按压回弹 + specular 高光 |
| **Dialog** | `ui/dialog.tsx` | `bg-[var(--glass-panel-bg)]`, `backdrop-blur-xl`, `border-[var(--glass-border)]`, `shadow-[var(--glass-shadow-lg)]`, `bg-[var(--glass-overlay)]` | `glass-press`（close 按钮） | Overlay 带 `backdrop-blur-md`；Content 带 zoom + slide 入场 |
| **Input** | `ui/input.tsx` | `border-[var(--glass-border-subtle)]`, `bg-[var(--glass-input-bg)]`, `shadow-[var(--glass-inset-shadow)]` | — | focus 时 primary ring + 边框加深 |
| **Select** | `ui/select.tsx` | Trigger: 同 Input；Content: `bg-[var(--glass-panel-bg)]`, `backdrop-blur-xl` | `glass-press`（trigger）, `glass-transition`（item） | 下拉面板带玻璃模糊 |
| **Switch** | `ui/switch.tsx` | `bg-[var(--glass-input-bg)]`, `border-[var(--glass-border)]`, `shadow-[var(--glass-inset-shadow)]` | `glass-press`, `duration-200`（thumb） | 未选中态带内凹阴影 |
| **Textarea** | `ui/textarea.tsx` | 同 Input | — | — |
| **Sonner** | `ui/sonner.tsx` | `bg-[var(--glass-panel-bg)]`, `backdrop-blur-xl` | — | Toast 通知带玻璃模糊 |

### 布局组件

| 组件 | 文件 | 玻璃态类 | 动效类 | 说明 |
|------|------|---------|--------|------|
| **CollapsiblePanel** | `layout/CollapsiblePanel.tsx` | `glass-panel`, `border-[var(--glass-divider)]` | `transition-all duration-300` | 面板折叠/展开动画 |
| **ResizeHandle** | `layout/ResizeHandle.tsx` | `hover:bg-[var(--glass-bg-hover)]`, `bg-[var(--glass-bg-active)]`, `border-[var(--glass-divider)]` | `glass-transition` | 拖拽手柄颜色平滑过渡 |
| **BranchPanel** | `layout/BranchPanel.tsx` | `glass-input`（搜索框）, `glass-surface-selected`（当前分支）, `border-[var(--glass-divider)]` | `glass-stagger`（列表）, `glass-transition`（列表项）, `glass-scrollbar` | 分支列表交错入场 |
| **RepositoryList** | `layout/RepositoryList.tsx` | `glass-surface`, 各项使用 glass 变量 | `glass-scrollbar` | 仓库列表自动隐藏滚动条 |
| **SettingsDialog** | `layout/SettingsDialog.tsx` | `glass-surface`（侧边栏）, `bg-[var(--glass-bg-active)]`（选中项）, `glass-kbd-*`（kbd 标签） | `glass-press` + `glass-transition`（导航项）, `glass-scrollbar`（内容区） | 分类导航按压反馈 |
| **ShortcutsDialog** | `layout/ShortcutsDialog.tsx` | `bg-[var(--glass-input-bg)]`, `glass-kbd-*` | `glass-stagger`, `glass-transition` | 快捷键列表交错入场 |

### 业务组件

| 组件 | 文件 | 玻璃态类 | 动效类 | 说明 |
|------|------|---------|--------|------|
| **EnvironmentCheckDialog** | `environment/EnvironmentCheckDialog.tsx` | `glass-code-bg`, `glass-border-subtle`, 各面板使用 glass 变量 | `glass-scrollbar` | 环境检查滚动区 |
| **ReleaseChecklistDialog** | `release/ReleaseChecklistDialog.tsx` | `glass-surface-selected`（选中步骤）, `glass-border-subtle` | `glass-stagger` + `glass-press` + `glass-transition`（步骤列表）, `glass-scrollbar` | 步骤列表交错入场 + 按压反馈 |
| **ConfigDialog** | `publish/ConfigDialog.tsx` | `glass-surface` | — | 空状态容器 |
| **CommandImportDialog** | `publish/CommandImportDialog.tsx` | `glass-input-bg`, `destructive/8` | — | 错误/结果区域 |
| **Parameter 组件** | `publish/Boolean\|String\|Array\|MapParameter.tsx` | `bg-[var(--glass-panel-bg)]`, `backdrop-blur-xl`, `glass-border`, `glass-shadow` | — | Tooltip 弹出层 |
| **App.tsx** | `App.tsx` | `glass-divider`, `glass-panel-bg`, `glass-code-bg` | `glass-scrollbar` | 主内容区滚动 |

---

## 无障碍与性能

### `prefers-reduced-motion`

当系统开启"减少动态效果"时，所有动画和过渡被禁用：

```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  .glass-hover-lift:hover, .glass-interactive:hover { transform: none; }
  .glass-press:active { transform: none; }
  .glass-shimmer-hover::after { display: none; }
  .glass-stagger > * { animation: none; opacity: 1; transform: none; }
}
```

### 性能优化

| 策略 | 实现 |
|------|------|
| **GPU 加速** | `will-change: transform, box-shadow` 仅在需要时声明 |
| **动画时长** | 所有动画 ≤ 350ms，避免用户等待感 |
| **按压响应** | `:active` 过渡仅 100ms，即时反馈 |
| **模糊分级** | Panel 40px > Surface 20px > Input 8px，按层级递减 |
| **伪元素** | specular 高光使用 `pointer-events: none`，不影响交互 |

---

## 使用指南

### 新增组件时的选择

```
需要容器/面板？     → .glass-panel 或 .glass-card
需要交互区域？     → .glass-surface
需要选中状态？     → .glass-surface-selected
需要输入框包裹？   → .glass-input
需要按钮/开关？    → 添加 .glass-press
需要卡片可点击？   → 添加 .glass-interactive
需要列表入场？     → 父容器添加 .glass-stagger
需要状态过渡？     → 添加 .glass-transition
需要滚动区域？     → 添加 .glass-scrollbar
需要分割线？       → border-[var(--glass-divider)]
```

### 边框选择

```
主要边框（卡片、面板）  → var(--glass-border)
次要边框（输入框、微妙） → var(--glass-border-subtle)
分割线                  → var(--glass-divider)
```

### 阴影选择

```
默认阴影     → var(--glass-shadow)
hover 提升   → var(--glass-shadow-lg)
选中状态     → var(--glass-shadow-selected)
输入框内凹   → var(--glass-inset-shadow)
```

### 圆角规范

| 元素类型 | 圆角 |
|---------|------|
| 卡片/面板/Dialog | `rounded-2xl`（16px） |
| 按钮/输入框/列表项 | `rounded-xl`（12px） |
| 小元素（标签/指示器） | `rounded-lg`（8px） |
| 开关/头像 | `rounded-full` |

---

## 文件索引

| 文件 | 职责 |
|------|------|
| `src/index.css` | CSS 变量定义、玻璃态工具类、动效系统、reduced-motion |
| `tailwind.config.cjs` | Tailwind 扩展动画、关键帧、弹簧 timing function |
| `src/components/ui/*.tsx` | shadcn/ui 组件，应用玻璃态样式 |
| `src/components/layout/*.tsx` | 布局组件，应用动效类 |
| `src/components/publish/*.tsx` | 发布相关组件，tooltip 弹出层玻璃态 |
| `src/components/environment/*.tsx` | 环境检查组件 |
| `src/components/release/*.tsx` | 发布清单组件 |
