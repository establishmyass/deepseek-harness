---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-19-task-surface-dismissed

[English](2026-09-19-task-surface-dismissed.md) | 中文

## 概述

新增 `task-surface/dismissed` 会话事件，按 surface id 记录一次已关闭的 Task Surface。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-19-task-surface-dismissed
baseline: false
changes:
  - root: "event:task-surface/dismissed"
    previous: null
    after: "a0e58dcc64d99e0fb31edd47206f30276da846470106991d758a0cbde466c468"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效。该事件带 `ignorable: true`，不认识该类型的构建会跳过它读取日志。读取方仅在关闭已打开的 `taskSurface` 面板时折叠该事件；没有其他消费者，且该事件缺失时面板状态仍可从日志恢复。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/tool-task-surface/tests/tool-task-surface.spec.ts：11 个测试通过，含 “closes on a matching dismissal or the user own next message” 与 “dismisses one exact surface through the command, and rejects anything else”。

<a id="dev-note"></a>
## 开发备注

无。
