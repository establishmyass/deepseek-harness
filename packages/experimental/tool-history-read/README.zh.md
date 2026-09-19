---
description: "面向需要找回被压缩历史的用户与维护者的 history_read 工具：列出压缩检查点并把被替换的区段读回来。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-history-read

[English](README.md) | 中文

## 概述

`dsh-experimental-tool-history-read` 为模型提供 `history_read` 工具，用于取回被上下文压缩移除的历史：不带参数时列出每个检查点（被替换的区段、其 token 代价，以及模型读到的那份摘要），带 `from`/`to` 时把某个区段读回为受上界约束的转录。读取经由 `ctx.sessionQuery`，因此该工具不会直接触碰存储后端或活动会话的内部结构。当会话压缩了长历史而工作仍需要原始文字时，选择它。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本插件与工具注册表和会话查询后端一起挂载；随附的 `dsh-base` 组合已提供两者，因此插入一行即可获得该工具。

### 命令参考

| 输入 | 结果 |
|---|---|
| `history_read({})` | 列出每个压缩检查点：seq、被替换的区段、token 代价，以及替换它的摘要 |
| `history_read({ from, to })` | 把该区段读回为 `user`、`system`、`assistant`、工具调用与工具结果行的转录 |

区段读取有三重上界：最多 `maxEvents` 个事件、每个事件最多 `maxEventChars` 个字符、整份转录最多 `maxBytes` 个字节。被截断的结果以一条omission 说明结尾，指明被舍弃的内容。

### 模型何时该用它

检查点列表说明压缩是否替换过内容，以及该读哪个区段。转录是原始日志内容，因此能取回摘要压缩掉的准确措辞、数字与工具参数。它不是搜索工具：查单个事件用 `session_event_read`，搜索过往会话用 `session_search`。

### 组合方式

```yaml
- insert:
    - id: tool-history-read
      name: '@deepseek-ai/dsh-experimental-tool-history-read'
      config:
        maxBytes: 8000
        maxEvents: 200
        maxEventChars: 2000
```

在仓库检出中，用 `dsh web --patch <file>` 应用此类覆盖层。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

本节说明本包如何实现上述行为；可观察契约见[使用本包](#use-this-package)。

### 设计要点

该工具是读取器而非存储：`compaction/summary` 事件本就携带被替换的区段（`shadowedRange`）与其摘要，而持久日志仍保留全部原始事件。因此一次 `sessionQuery.readSession()` 即可服务两种模式——列表过滤这些事件，区段读取切片这些事件——本包只负责校验、渲染与上界。渲染复用 `TextRetainer` 这一共享字节预算累加器，转录在字符边界处截断并报告精确的省略字节数。

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`history_read` 工具、模式分发、范围校验、上界配置 |
| [`src/transcript.ts`](src/transcript.ts) | 检查点提取、逐事件行、检查点索引、受界区段渲染 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

本包是对既有接缝的轻量读取器；阅读以下页面了解它使用的机制。

- [会话查询服务](../../session-query/session-query/README.zh.md) — 本工具调用的活动优先读取接缝。
- [压缩包](../../compaction/compaction/README.zh.md) — 检查点列表所读的摘要事件与影子价格协议。
- [会话子系统](../../../docs/subsystems/session.zh.md) — 转录所渲染的事件日志与表面。
- [可回读压缩](../../../.agents/notes/proposed/feature/2026-07-06-recallable-compaction.zh.md) — 本工具作为其第一片切片的提案设计。

-----

<a id="model-experience"></a>
## 模型体验

### 取回被压缩的历史

#### 模型看到什么

只有调用返回的内容。索引模式返回固定表头 `Compaction replaced this history. Read a span with history_read({ from, to }):`，随后每个检查点一行——`checkpoint #<seq> replaced events #<start>–<end> (<count> events, <tokens> tokens): <summary>`——或返回固定句子 `No compaction has removed history from this session: every event is still in your current view.` 读取模式为每个含内容事件返回一行，标签为 `user:`、`system:`、`assistant:`、`tool call <name>(<arguments>)` 或 `tool result:`，受上界约束时其后跟随 `Omitted <n> later events.` 与 `Omitted <n> bytes.`

#### Token 影响

模型调用之前为零 token。成功调用会把返回文本加入被保留的历史，并在后续步骤中重发，因此不必要的宽区段会在之后每个请求上产生 token 成本。

#### KV Cache 影响

仅追加：工具调用及其结果位于可复用的请求前缀之后，不会使既有缓存失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了该工具何时不合适。它们是当前包的约束，不是任务清单。

- **仅覆盖摘要式压缩** — 工具结果剪枝与图片卸载通过各自的事件替换历史，尚未列出。
- **索引只能主动拉取** — 模型已经读到的摘要文本上没有检查点指针，模型必须调用工具才能获知历史被替换过。
- **没有分页** — 一次调用最多返回 `maxEvents`/`maxBytes`；缩小范围由调用方负责。
- **必须挂载查询后端** — 该工具注入 `ctx.sessionQuery`，由组合通过 `dsh-session-query-sqlite` 等后端提供。
- **附件不渲染** — 图片与文件块不产生转录行。
- **没有 UI 呈现** — 该调用通过通用工具卡渲染。
- **仅有包级测试** — 按[测试政策](../../../docs/testing.zh.md)，Loader 真实组合测试与录制会话快照仍待补齐。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性。尚未决定的方向：把检查点索引并入摘要文本本身、用异步分页读取取代整份日志加载，以及把剪枝与图片卸载的替换与摘要并列列出。

</details>

**运行时不变式：** 不发布伴生入口。读取经由 `ctx.sessionQuery`，存储的历史由它拥有并校验，本工具自身从不建立索引。
