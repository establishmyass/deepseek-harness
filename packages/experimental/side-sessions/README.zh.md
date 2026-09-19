---
description: "面向希望在不污染主对话的前提下探索旁支问题的用户与维护者的 /side 命令：把会话分叉为顾问并合回其结论。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-side-sessions

[English](README.md) | 中文

## 概述

`dsh-experimental-side-sessions` 提供 `/side` 人类命令：把发起命令的会话在其最后一个已完成轮次处分叉为一个由本插件持有的普通活动会话，将该分叉框定为顾问，在其中提出用户的问题，并把一份带长度上限的结论合回父会话。它复用既有原语——会话分叉元数据、agent 工厂、agent 注入与命令注册表——不新增服务、会话事件或存储方法。当用户希望在主对话旁边探索问题而不污染主对话时，选择它。

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

把本插件与命令适配器、agent 工厂和会话存储一起挂载；随附的 `dsh-base` 组合已提供这三者，因此插入一行即可获得该命令。

### 命令参考

| 输入 | 结果 |
|---|---|
| `/side <question>` | 在本会话最后一个已完成轮次处打开一个侧会话，并在其中提出该问题 |
| `/side merge` | 把最新侧会话的最终回答作为插件来源的上下文注入本会话 |
| `/side close` | 释放本插件从本会话打开的全部活动侧会话 |

裸 `/side` 会输出用法。`merge` 与 `close` 是操作字面量，因此文本恰好等于它们的问题需要改写措辞。

### 什么是侧会话

- **是分叉，不是子代理。** 子会话是普通的已发布 agent 与会话：它继承父会话直到最后一个 `turn/end` 的全部事件，头部携带 `parentSession`/`isSeeded` 血统信息，并像其他会话一样出现在会话列表中。
- **顾问框定。** 一条插件来源的用户消息说明该会话是为回答旁支问题而分叉的，并要求解释而非修改。
- **父会话的路由。** 子会话继承父会话的 `provider` 与 `model`，使被复制的历史仍可复用前缀缓存。
- **带上限的回交。** `/side merge` 读取子会话最终落定的助手文本，并将其至多 `mergeMaxBytes` 个 UTF-8 字节注入父会话；截断不会切断字符。
- **插件持有生命周期。** 本插件卸载或运行 `/side close` 时关闭侧会话；父会话自身的销毁不会触及它们。

### 组合方式

```yaml
- insert:
    - id: side-sessions
      name: '@deepseek-ai/dsh-experimental-side-sessions'
      config:
        mergeMaxBytes: 4000
```

在仓库检出中，用 `dsh web --patch <file>` 应用此类覆盖层；凡消费 `ctx.commands` 的适配器都可使用该命令。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部机制 — 点击展开</summary>

本节说明本包如何实现上述行为；可观察契约见[使用本包](#use-this-package)。

### 设计要点

除必须释放的活动句柄外，本包不持有领域状态。打开侧会话是一次带 seed 与血统元数据的 agent 工厂调用；框定与提问都是普通用户消息；合并读取子会话的派生历史，并向父会话注入一条插件来源消息，父会话的下一次请求会在其记录位置读到它。因此定位某会话的侧会话无需自建注册表：读取活动会话列表，用插件 id 前缀与头部的 `parentSession` 匹配即可。

### 源码索引

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`/side` 命令、分叉并提问、合并、关闭、活动句柄归属 |
| [`src/text.ts`](src/text.ts) | 结论文本提取与 UTF-8 字节上限 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

本包是对既有接缝的轻量组合；阅读以下页面了解它使用的机制。

- [会话子系统](../../../docs/subsystems/session.zh.md) — 分叉、血统元数据与派生历史。
- [agent 包](../../core/agent/README.zh.md) — agent 工厂、注入与作用域销毁。
- [命令服务](../../interaction/commands/README.zh.md) — 本插件所贡献的注册表。
- [分叉子代理后端](../../subagent/subagent-fork-in-process/README.zh.md) — 本包复用的已完成轮次前缀规则。
- [交互式侧会话](../../../.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.zh.md) — 本包所实现的提案设计。

-----

<a id="model-experience"></a>
## 模型体验

### 分叉会话中的顾问框定

#### 模型看到什么

子会话先收到继承的已完成轮次前缀，然后收到一条插件来源用户消息，其内容为下面的顾问框定，随后问题以普通用户消息到达。

##### 顾问框定

```markdown
This session was forked from another conversation to answer one side question. Explain and analyze; do not modify files, run mutating commands, or continue the original task.
```

#### Token 影响

继承的前缀会在子会话的请求中再次计费。框定与问题各新增一条被保留的用户消息；后续子会话轮次独立于父会话累积自身 token。

#### KV Cache 影响

当 provider 与 model、系统提示词与工具 schema 保持逐字节一致时，子会话复用继承前缀；继承的路由与不变的组合保证了这一点。

### 父会话中的合并结论

#### 模型看到什么

一条插件来源用户消息，携带子会话最终助手文本，上限为 `mergeMaxBytes` 个 UTF-8 字节；它位于唤醒父会话的提示之前。

#### Token 影响

父会话被保留的历史至多新增配置的字节预算；重复合并各新增一条消息。

#### KV Cache 影响

仅追加：该结论位于可复用的父会话前缀之后，不会使既有缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了该命令何时不合适或需要留意。它们是当前包的约束，不是任务清单。

- **合并的结论就是子会话的最终回答** — 没有专门的回交请求，因此长回答会被截断而非摘要。
- **顾问框定只是建议性的** — 只读行为尚未强制；实施强制拒绝的 `tools/pre-execute` 门禁仍待完成。
- **合并只解析活动会话** — 本插件重新加载后其子会话被关闭，无法再被合并发现。
- **只继承路由** — 推理强度与输出 token 上限不会复制到子会话。
- **命令平面是唯一入口** — 尚未提供面向模型的工具与客户端呈现。
- **仅有包级测试** — 按[测试政策](../../../docs/testing.zh.md)，Loader 真实组合测试与录制会话快照仍待补齐。
- **前缀读取使用已弃用的读取器** — 与随附的分叉后端一样，分叉通过 `snapshotEvents()` 读取父会话历史；迁移到显式存储读取仍待完成。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文，明确不具权威性。尚未决定的方向：面向模型的侧会话工具、客户端可见的会话切换与回交呈现，以及把分叉能力产品化为 rewind/会话树。

</details>
