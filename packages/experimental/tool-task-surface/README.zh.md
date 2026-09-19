---
description: "实验性的 show_task_surface 工具：下发一个结构化的 Task Surface 面板，并结束本轮对话等待用户作答。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-task-surface

[English](README.md) | 中文

## 概述

`dsh-experimental-tool-task-surface` 给模型一个稳定工具 `show_task_surface`，用于那些用一块结构化面板比来回散文更清楚的交互：一张对比表、一组选项，或一小组相关字段。调用发布 `TaskSurfaceModelV1`，由客户端渲染，调用成功后本轮对话结束。`taskSurface` 投影把打开的面板发布给每个载体，`/task-surface dismiss <surfaceId>` 可持久关闭。当持久的成果是用户的结论时选它。

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

把本插件挂在工具注册表旁；除了 `ctx.tools`，该工具不依赖任何服务。Web 面板是另一个按需启用的包 [client-ui-task-surface](../client-ui-task-surface/README.zh.md)，因此即使宿主没装它，工具依然会 advertise —— 此时结果文本会告知模型：用户在对话里直接作答。

### 声明的模型

| 部分 | 支持的值 |
|---|---|
| `sections[]` | `id`、可选 `title`、可选 `layout`（`stack`，或 2–3 列的 `grid`）、`blocks[]` |
| blocks | `markdown`（图片只渲染 alt 文本）、`metrics`、`table`（行以列 id 为键）、`notice`（`neutral`/`info`/`warning`） |
| `fields[]` | `text`（单行或多行 `multiline`，可选 `required` 与 `initial`）、`choice`、`multi-choice`、`toggle` |
| `submit` | `{ label }` |

声明式 schema 之外的参数会在执行前被拒绝，因此不支持的字段类型会直接让调用失败，而不是渲染出一块残缺面板。

### 打开的面板

一个 `taskSurface` 投影单元把会话日志折叠成每个载体都能读到的面板：调用成功即打开；一条关闭事件或用户自己的下一条消息即关闭。投影值携带调用的身份、面板的内容地址，以及原样记录的模型 —— 因此客户端仅凭投影就能恢复面板，即使打开它的那次调用已经滚出已加载的历史。

| 字段 | 含义 |
|---|---|
| `active.callId` | 打开该面板的那次成功 `show_task_surface` 调用 |
| `active.surfaceId` | 模型的内容地址（16 位十六进制） |
| `active.model` | 已验证的模型，载体渲染前会再次校验 |

### 关闭

`/task-surface dismiss <surfaceId>` 追加一条 `task-surface/dismissed` 事件，且不开启新一轮。它是持久的关闭路径：日志才是权威，因此重载后两侧一致。用户发任意普通消息同样会关闭面板——这就是有文档的绕过方式。

### 限额

| 上界 | 值 |
|---|---|
| Whole model | 64 KiB |
| Sections | 12 |
| Blocks per section | 8 |
| Fields | 24 |
| Table rows | 200 |

超限即 `INVALID_ARGS` 失败，模型可在同一轮内重试。

### 组合方式

```yaml
- insert:
    - id: tool-task-surface
      name: '@deepseek-ai/dsh-experimental-tool-task-surface'
```

在仓库检出目录中，用 `dsh web --patch <file>` 应用这样一份 overlay。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

本节说明该包如何实现上面的行为；可观测的契约见 [使用本包](#use-this-package)。

### 设计要点

这个工具只负责契约本身，其余全部委派出去。一份 `defineTool` 声明负责校验并窄化模型数据，函数体不再重新解析。随后函数体做限额检查、计算面板的内容地址（对已记录参数取 `sha256` 的前 16 位十六进制——同样的参数永远指向同一块面板，因此重载与重发都能对上）、通过 `output.presentationMeta` 持久化规范化模型（工具自己的结果事件就是载体唯一能回读它的持久位置），并调用 `exec.concludeTurn()`，让 agent 无法越过这个人类检查点继续执行。`isConcurrencySafe` 刻意省略：按工具注册表的契约，省略即把每次调用归为独占排序屏障，这正是"结束本轮"的呈现所需要的。投影单元是对已提交事件的纯折叠：`tool/call` 记下候选，对应的 `tool/result` 要么打开面板（带标签的元数据），要么丢弃候选（调用被拒），而匹配的关闭事件或一条真实用户消息负责关闭它。无关事件返回同一个 state 引用，这正是发布保持静默的原因。

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：注册工具、投影单元与关闭命令 |
| [`src/tool.ts`](src/tool.ts) | 模型 schema、限额策略、surface id 与 `show_task_surface` |
| [`src/meta.ts`](src/meta.ts) | 工具写入、投影读取的带标签结果载荷 |
| [`src/projection.ts`](src/projection.ts) | `taskSurface` 单元、其状态与客户端视图 |
| [`src/command.ts`](src/command.ts) | `/task-surface dismiss <surfaceId>` |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Task Surface for structured session interaction](../../../.agents/notes/proposed/feature/2026-08-04-task-surface.zh.md) —— 本工具所属提案的完整设计。
- [Canonical tool output contract](../../../.agents/notes/implemented/architecture/2026-07-20-canonical-tool-output-contract.zh.md) —— 为什么结果 value 仅存在于本次执行。
- [Adding a tool](../../../docs/cookbook/adding-a-tool.zh.md) —— 本包遵循的声明式写法。

-----

<a id="model-experience"></a>
## 模型体验

### Task Surface 呈现

#### 模型看到什么

先是它自己发出的调用参数，然后是本轮结束时工具返回的结果文本。

##### 结果文本

```markdown
Task Surface "<title>" (<surfaceId>) is open in the panel. The turn ended here: submit the panel to answer it, or send an ordinary message to bypass it and put the panel aside. Do not restate the panel in prose.
```

#### Token 影响

每次请求里有一份声明，与具体任务模型无关；结果文本每块面板一次。面板内容本身从不进入提示词：模型知道自己发了什么，而用户的答复以一条普通消息的形式到达。

#### KV Cache 影响

仅追加：工具调用与其结果接在可复用前缀之后，模型也从不重发面板。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了什么时候不该用它。它们是当前包的约束，不是任务清单。

- **同时只有一块面板，但不拒绝第二次调用** —— 投影只保留最近一次成功调用，因此第二次调用会替换掉前一块面板，而不是失败；提案里的"已有面板时拒绝"检查尚未实现。
- **没有提交记录** —— 没有 branded 提交 id、没有事务性认领、也没有队列协调：提交就是一条普通消息，重复提交即两条消息，`edit`/`steer` 也不受限。
- **关闭不按 id 幂等** —— 每次调用都会追加一条事件；重试只会再追加一条，而只有匹配的 `surfaceId` 会关闭面板。
- **没有 `order` 字段类型** —— 可拖拽排序列表不在这片切片内，声明式 schema 会直接拒绝。
- **没有 `diff` 区块** —— 另一个已声明区块类型延后。
- **没有 render intent** —— 只有在客户端注册了对应键控 Tool view 的地方才会出现面板。
- **仅包级测试** —— 按[测试策略](../../../docs/testing.zh.md)，Loader 真实组合测试与录制会话快照仍待补。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本 Dev Note 是维护者的工作上下文，明确非权威。尚未决定：限额策略是否应该放进 schema（JSON Schema 的 `maxItems`/`maxLength`）而不是函数体；以及 surface id 是否应对归一化后的模型取哈希，而不是对已记录参数。

</details>

**运行时不变式：** 不发布伴生入口。`taskSurface` 投影折叠已提交的会话事件，投影注册本身即校验该折叠。
