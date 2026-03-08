# 项目任务分解规划

## 已明确的决策

- 复用项目中 ConfigDialog 已有的滚动模式（`max-h-[80vh] flex flex-col` + `flex-1 overflow-y-auto`）
- 仅修改 CSS 类名，不改变组件结构和逻辑
- 破坏式修改，不保留旧的无滚动行为

## 整体规划概述

### 项目目标

修复 QuickCreateProfileDialog 弹窗在内容超出视口高度时无法滚动的问题，使 DialogHeader 和 DialogFooter 固定，中间表单区域可滚动。

### 技术栈

- React + TypeScript
- shadcn/ui Dialog 组件
- Tailwind CSS

### 主要阶段

1. 修改弹窗样式（单阶段，两处 className 变更）

### 详细任务分解

#### 阶段 1：添加滚动支持

- **任务 1.1**：为 DialogContent 添加高度限制和 flex 布局
  - 目标：限制弹窗最大高度为视口 80%，启用纵向 flex 布局
  - 输入：当前 className `"sm:max-w-[840px]"`
  - 输出：修改为 `"sm:max-w-[840px] max-h-[80vh] flex flex-col"`
  - 涉及文件：`/Users/erictao/source/repos/one-publish/src/App.tsx` 第 5113 行
  - 预估工作量：1 分钟

- **任务 1.2**：为表单容器添加 flex-1 和溢出滚动
  - 目标：表单区域填充剩余空间，内容溢出时可滚动
  - 输入：当前 className `"space-y-4"`
  - 输出：修改为 `"flex-1 space-y-4 overflow-y-auto"`
  - 涉及文件：`/Users/erictao/source/repos/one-publish/src/App.tsx` 第 5123 行
  - 预估工作量：1 分钟

- **任务 1.3**：验证修复效果
  - 目标：确认弹窗在不同窗口尺寸下表现正确
  - 验收标准：
    - 窗口高度充足时，弹窗正常显示无滚动条
    - 窗口高度不足时，表单区域出现滚动条，Header/Footer 固定
    - 预置模板区域的内部滚动（`max-h-[240px] overflow-y-auto`）不受影响
  - 预估工作量：2 分钟

## 需要进一步明确的问题

无。方案明确，参考项目内已有模式，改动最小化。

## 用户反馈区域

请在此区域补充您对整体规划的意见和建议：

```
用户补充内容：
___
___
___
```