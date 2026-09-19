---
description: "实验性的 Web Task Surface 面板：把一次 show_task_surface 调用渲染成可填写的表单，并作为一条普通用户消息提交。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-task-surface

[English](README.md) | 中文

## 概述

`dsh-experimental-client-ui-task-surface` 把一次 `show_task_surface` 调用渲染到两处：输入框上方的 dock 是编辑器，转录里的键控工具行是只读回放。两者都读宿主的 `taskSurface` 投影与已记录的调用参数，因此刷新或重连都能恢复同一块面板。提交是一条普通用户消息，关闭则追加一条持久日志事件。

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

把它挂在同时挂载工具的 Web 组合里：呈现归本包，schema 归 [`tool-task-surface`](../tool-task-surface/README.zh.md)。它会为 wire 名 `show_task_surface` 注册一个键控 `tool.call.toolview`，因此只替换这一次调用的通用工具行，别的调用不受影响。

### 用户能得到什么

- 打开的面板出现在输入框上方的 dock 里，标题取自面板自身，旁边只有一个关闭控件。dock 是唯一的编辑器；转录行只读回放同一块面板。
- 关闭会通过 `/task-surface dismiss <surfaceId>` 追加一条持久日志事件，因此重载后、跨客户端都保持关闭。用户若改为发送任意普通消息，同样会关闭它——这就是有文档的绕过方式。
- 所有声明的区块按声明顺序渲染；`grid` 分栏按 2–3 列排布，面板变窄时收成一列。
- Markdown 里的图片语法只渲染 alt 文本：不抓取任何模型给的 URL，也不在用户自行点击链接前显示图片。
- 必填文本字段未填时提交控件保持关闭；toggle 始终上报自己的状态；未填的可选字段直接从提交里省略。
- 提交失败时所有输入保持可编辑，并把 transport 返回的原因显示出来。

### 组合方式

```yaml
- insert:
    - id: client-ui-task-surface
      name: '@deepseek-ai/dsh-experimental-client-ui-task-surface'
```

在仓库检出目录中，用 `dsh web --patch <file>` 应用这样一份 overlay。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

本节说明该包如何实现上面的行为；可观测的契约见 [使用本包](#use-this-package)。

### 设计要点

面板是"日志已经记录的内容"的纯函数。dock 读宿主的 `taskSurface` 投影 —— 身份加上原样记录的模型 —— 因此即使打开它的调用不在已加载历史里，面板依然可操作；工具行读的则是调用**自身**的参数，也就是运行中与已结算节点都携带的那份持久切片。两处解析都是严格的：不支持的版本、结构损坏的 section、或本切片不渲染的区块/字段分支，一律返回"没有面板"，该挂载点改为显示普通工具结果文本，而不是解释出一块残缺表单。两条写路径是注册插件注入的动词：`submit` 按 view 自身的作用域解析出业务 Session，并以 `queue` 模式准入一条文本消息；`dismiss` 执行宿主命令，由它的事件关闭投影。两个组件都不接触 transport、store 或其他插件。

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：字典、两处注册，以及提交与关闭动词 |
| [`src/client/TaskSurfaceDock.tsx`](src/client/TaskSurfaceDock.tsx) | 编辑器：读取投影、挂载面板、关闭 |
| [`src/client/TaskSurfaceCard.tsx`](src/client/TaskSurfaceCard.tsx) | 一次已记录调用的键控只读回放 |
| [`src/client/TaskSurfacePanel.tsx`](src/client/TaskSurfacePanel.tsx) | 共享面板主体：区块、字段、表单生命周期、动作行 |
| [`src/client/model.ts`](src/client/model.ts) | 模型类型、严格解析、初始值、提交格式化 |
| [`src/client/TaskSurfaceCard.module.css`](src/client/TaskSurfaceCard.module.css) | 面板与 dock 布局及主题 token 样式 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Task Surface for structured session interaction](../../../.agents/notes/proposed/feature/2026-08-04-task-surface.zh.md) —— 提案全文，含本切片未实现的 Dock。
- [Tool view slot contract](../../../docs/subsystems/slots.zh.md) —— 键控 `tool.call.toolview` 如何接管一行工具调用。
- [`MarkdownText`](../../client/ui-primitives/README.zh.md) —— 面板复用的共享 Markdown 渲染器。
- [Session Controller client](../../api/session-controller/README.zh.md) —— 提交经由其 `prompt` 准入的业务 Session。

-----

<a id="model-experience"></a>
## 模型体验

### Task Surface 提交

#### 模型看到什么

先是它自己的 `show_task_surface` 调用；用户提交之后，再收到一条由本面板格式化的普通用户消息。面板的其他部分不会进入提示词。

##### 提交消息

```markdown
Task Surface "<title>" answers
- <field label>: <submitted value>
```

#### Token 影响

用户提交前为零；格式化后的消息随后像任何一条用户轮次那样进入保留历史。面板的区块与布局从不进入提示词。

#### KV Cache 影响

无直接影响：面板在本地渲染，不贡献任何请求内容。提交是追加在可复用前缀之后的一条普通用户消息。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了面板在什么时候不够用。它们是当前包的约束，不是任务清单。

- **只挂工具行就没有编辑器** —— 工具行按设计是只读的（单一草稿属主），因此只挂本包工具行的组合只能看面板、不能填；普通消息绕过依然可用。
- **草稿不持久化** —— 取值活在组件状态里，刷新会丢掉未提交的答复；已提交的答复存在用户消息里。
- **没有提交记录** —— 没有 `submissionId`、没有事务性认领、也没有队列协调：重复提交即两条消息，关闭也不按 id 幂等。
- **没有折叠** —— 提案里的 dock 折叠（本地视图状态）未实现；面板要么关闭，要么一直开着。
- **严格解析，不做局部面板** —— 一个不支持的分支或损坏的 section 会让整次调用退回普通工具结果。
- **组件词汇表固定** —— 只有工具声明的四种区块、四种字段与两种布局；未知的一律在渲染前被拒绝。
- **仅包级测试** —— 按[测试策略](../../../docs/testing.zh.md)，经由真实 Web 插件宿主的无密钥浏览器组合测试仍待补。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本 Dev Note 是维护者的工作上下文，明确非权威。尚未决定：调用结算后面板是否应自动置为不可编辑；草稿是否该放进现有的按会话 slot store；以及 alt-only 图片规则是否应作为策略 prop 移入 `MarkdownText`，让所有模型产出的界面共享同一条规则。

</details>

**运行时不变式：** 不发布伴生入口。面板状态归宿主投影所有；本客户端只渲染它，不持有任何持久关系。
