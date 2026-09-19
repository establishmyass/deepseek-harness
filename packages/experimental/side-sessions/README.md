---
description: "The /side command that forks a session into an advisor and merges its answer back for users and maintainers exploring side questions without changing the main conversation."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-side-sessions

English | [中文](README.zh.md)

## Summary

`dsh-experimental-side-sessions` adds the `/side` human command: it forks the invoking session at its last completed turn into an ordinary live session owned by this plugin, frames that fork as an advisor, asks the user's question there, and merges one length-capped note back into the parent conversation. It composes existing primitives — session fork metadata, the agent factory, agent injection, and the command registry — and adds no new service, session event, or store method. Choose it where a user wants to explore a question beside the main conversation without polluting it.

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

Mount this plugin beside a command adapter, the agent factory, and the session store; the shipped `dsh-base` composition already provides all three, so one inserted row adds the command.

### Command reference

| Input | Result |
|---|---|
| `/side <question>` | Opens a side session forked at this session's last completed turn and asks the question there |
| `/side merge` | Injects the newest side session's final answer into this session as plugin-sourced context |
| `/side close` | Disposes every live side session this plugin opened from this session |

A bare `/side` reports usage. The literal inputs `merge` and `close` are operations, so a question with either exact text needs different wording.

### What a side session is

- **A fork, not a subagent.** The child is an ordinary published agent and session: it inherits every event up to the parent's last `turn/end`, carries `parentSession`/`isSeeded` lineage in its header, and appears in session lists like any other session.
- **Advisor framing.** One plugin-sourced user message explains that the session was forked to answer a side question and asks for explanation rather than mutation.
- **The parent's route.** The child inherits the parent's `provider` and `model` so the copied history stays eligible for prefix-cache reuse.
- **A capped handback.** `/side merge` reads the child's final settled assistant text and injects at most `mergeMaxBytes` UTF-8 bytes of it into the parent; a cut never splits a character.
- **Plugin-owned lifetime.** Side sessions close when this plugin unloads or `/side close` runs, and the parent's own teardown does not reach them.

### Compose it

```yaml
- insert:
    - id: side-sessions
      name: '@deepseek-ai/dsh-experimental-side-sessions'
      config:
        mergeMaxBytes: 4000
```

From a repository checkout, apply such an overlay with `dsh web --patch <file>`; the command exists for every adapter that consumes `ctx.commands`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The package owns no domain state beyond the live handles it must dispose. Opening a side session is one agent-factory call with a seed and lineage metadata; the framing and the question are ordinary user messages; merging reads the child's derived history and injects one plugin-sourced message into the parent, which the parent's next request reads at its logged position. Locating a session's side sessions therefore needs no registry of its own: it reads the live session list and matches the plugin's id prefix with the header's `parentSession`.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `/side` command, fork-and-ask, merge, close, live-handle ownership |
| [`src/text.ts`](src/text.ts) | Note text extraction and the UTF-8 byte cap |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The package is a thin composition over existing seams; read these pages for the mechanisms it uses.

- [Session subsystem](../../../docs/subsystems/session.md) — forks, lineage metadata, and derived history.
- [Agent package](../../core/agent/README.md) — the agent factory, injection, and scoped teardown.
- [Commands service](../../interaction/commands/README.md) — the registry this plugin contributes to.
- [Fork subagent backend](../../subagent/subagent-fork-in-process/README.md) — the completed-turn prefix rule this package reuses.
- [Interactive side sessions](../../../.agents/notes/proposed/feature/2026-07-08-interactive-side-sessions.md) — the proposed design this package implements.

-----

<a id="model-experience"></a>
## Model Experience

### Advisor framing in the forked session

#### What the model sees

The child receives the inherited completed-turn prefix, then one plugin-sourced user message with the advisor framing below, then the question as an ordinary user message.

##### Advisor framing

```markdown
This session was forked from another conversation to answer one side question. Explain and analyze; do not modify files, run mutating commands, or continue the original task.
```

#### Token effect

The inherited prefix is paid again in the child's requests. The framing and the question add one retained user message each; later child turns accumulate their own tokens independently of the parent.

#### KV Cache effect

The child reuses the inherited prefix while the provider and model, the system prompt, and the tool schemas stay byte-identical, which the inherited route and the unchanged composition preserve.

### Merged note in the parent conversation

#### What the model sees

One plugin-sourced user message carrying the child's final assistant text, capped at `mergeMaxBytes` UTF-8 bytes; it precedes the prompt that wakes the parent.

#### Token effect

At most the configured byte budget is added to the parent's retained history; repeated merges add one message each.

#### KV Cache effect

Append-only: the note follows the reusable parent prefix and invalidates no existing cache entry.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the command is the wrong tool or needs care. They are current package constraints, not a task backlog.

- **The merged note is the child's final answer** — there is no dedicated handback request, so a long answer is capped rather than summarized.
- **Advisor framing is advisory** — read-only behavior is not enforced; an enforcing `tools/pre-execute` deny gate is deferred.
- **Merge resolves live sessions only** — after this plugin reloads, its children are closed and no longer discoverable for merge.
- **Only the route is inherited** — reasoning effort and output-token caps are not copied to the child.
- **The command plane is the only entry** — no model-facing tool and no client presentation are provided yet.
- **Package-level tests only** — a Loader real-composition test and a recorded-session snapshot are still owed by the [testing policy](../../../docs/testing.md).
- **The prefix read uses a deprecated reader** — like the shipped fork backends, the fork reads the parent's history through `snapshotEvents()`; migrating it to an explicit storage read is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Open, undecided: a model-facing side-session tool, client-visible session switching and handback rendering, and a rewind/session-tree productization of the fork capability.

</details>

**Runtime invariant:** No companion is published. This plugin registers one command and owns no state whose independent observations could diverge; the session store and the command registry own every relationship it reads.
