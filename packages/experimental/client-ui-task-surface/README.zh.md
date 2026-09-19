---
description: "实验性的 Web Task Surface 面板：把一次 show_task_surface 调用渲染成可填写的表单，并作为一条普通用户消息提交。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-task-surface

[English](README.md) | 中文

## Summary

`dsh-experimental-client-ui-task-surface` 把一次 `show_task_surface` 调用渲染成对话里的一块可填写面板：声明的内容区块（Markdown、metrics、表格、notice）加上声明的输入字段（text、choice、multi-choice、toggle），以及一个提交控件。提交会把答复作为**一条普通用户消息**发出，因此结论留在转录里，并通过与输入框相同的准入路径开启下一轮。凡是会出现 Task Surface 面板的会话都可以挂它；没挂时，同样的调用退回成普通工具结果文本。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

把它挂在同时挂载工具的 Web 组合里：呈现归本包，schema 归 [`tool-task-surface`](../tool-task-surface/README.zh.md)。它会为 wire 名 `show_task_surface` 注册一个键控 `tool.call.toolview`，因此只替换这一次调用的通用工具行，别的调用不受影响。

### What the user gets

- 所有声明的区块按声明顺序渲染；`grid` 分栏按 2–3 列排布，面板变窄时收成一列。
- Markdown 里的图片语法只渲染 alt 文本：不抓取任何模型给的 URL，也不在用户自行点击链接前显示图片。
- 必填文本字段未填时提交控件保持关闭；toggle 始终上报自己的状态；未填的可选字段直接从提交里省略。
- 提交失败时所有输入保持可编辑，并把 transport 返回的原因显示出来。

### Compose it

```yaml
- insert:
    - id: client-ui-task-surface
      name: '@deepseek-ai/dsh-experimental-client-ui-task-surface'
```

在仓库检出目录中，用 `dsh web --patch <file>` 应用这样一份 overlay。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

本节说明该包如何实现上面的行为；可观测的契约见 [Use this package](#use-this-package)。

### Design concept

面板是"本轮已记录内容"的纯函数。卡片从工具调用**自身**的参数里读出模型 —— 运行中与已结算节点上是同一份持久切片 —— 因此刷新、重连、把转录往回滚，都会渲染出完全相同的面板，不需要宿主往返，也不需要第二份模型副本。解析是严格的：不支持的版本、结构损坏的 section、或本切片不渲染的区块/字段分支，一律返回"没有面板"，卡片改为显示普通工具结果文本，而不是解释出一块残缺表单。唯一的写路径是注册插件注入的 `submit`：它按 view 自身的作用域解析出业务 Session，并以 `queue` 模式准入一条文本消息；卡片本身从不接触 transport、store 或其他插件。

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 浏览器插件：字典、键控 Tool view 注册与提交写入器 |
| [`src/client/TaskSurfaceCard.tsx`](src/client/TaskSurfaceCard.tsx) | 模型解析、区块与字段渲染、提交格式化、表单生命周期 |
| [`src/client/TaskSurfaceCard.module.css`](src/client/TaskSurfaceCard.module.css) | 面板布局与主题 token 样式 |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Task Surface for structured session interaction](../../../.agents/notes/proposed/feature/2026-08-04-task-surface.zh.md) —— 提案全文，含本切片未实现的 Dock。
- [Tool view slot contract](../../../docs/subsystems/slots.zh.md) —— 键控 `tool.call.toolview` 如何接管一行工具调用。
- [`MarkdownText`](../../client/ui-primitives/README.zh.md) —— 面板复用的共享 Markdown 渲染器。
- [Session Controller client](../../api/session-controller/README.zh.md) —— 提交经由其 `prompt` 准入的业务 Session。

-----

<a id="model-experience"></a>
## Model Experience

### Task Surface submission

#### What the model sees

先是它自己的 `show_task_surface` 调用；用户提交之后，再收到一条由本面板格式化的普通用户消息。面板的其他部分不会进入提示词。

##### Submission message

```markdown
Task Surface "<title>" answers
- <field label>: <submitted value>
```

#### Token effect

用户提交前为零；格式化后的消息随后像任何一条用户轮次那样进入保留历史。面板的区块与布局从不进入提示词。

#### KV Cache effect

无直接影响：面板在本地渲染，不贡献任何请求内容。提交是追加在可复用前缀之后的一条普通用户消息。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

这些限制定义了面板在什么时候不够用。它们是当前包的约束，不是任务清单。

- **转录行是唯一的编辑器** —— 提案里的 `TaskSurfaceDock` 依赖宿主投影、`getActive` 与事务性提交记录；在那之前，结果已滚出已加载窗口的面板无法重新填写。
- **草稿不持久化** —— 取值活在组件状态里，刷新会丢掉未提交的答复；已提交的答复存在用户消息里。
- **没有关闭事件，也没有作答历史** —— 没有 dismissal 事件、没有 `submissionId`、也没有只读回放态；面板始终可编辑，再次提交就是第二条消息。
- **严格解析，不做局部面板** —— 一个不支持的分支或损坏的 section 会让整次调用退回普通工具结果。
- **组件词汇表固定** —— 只有工具声明的四种区块、四种字段与两种布局；未知的一律在渲染前被拒绝。
- **仅包级测试** —— 按[测试策略](../../../docs/testing.zh.md)，经由真实 Web 插件宿主的无密钥浏览器组合测试仍待补。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

本 Dev Note 是维护者的工作上下文，明确非权威。尚未决定：调用结算后面板是否应自动置为不可编辑；草稿是否该放进现有的按会话 slot store；以及 alt-only 图片规则是否应作为策略 prop 移入 `MarkdownText`，让所有模型产出的界面共享同一条规则。

</details>
