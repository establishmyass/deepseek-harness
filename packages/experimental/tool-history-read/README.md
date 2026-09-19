---
description: "The history_read tool that lists compaction checkpoints and reads replaced spans back for users and maintainers recovering compacted context."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-history-read

English | [中文](README.zh.md)

## Summary

`dsh-experimental-tool-history-read` gives the model a `history_read` tool for the history that context compaction removed: with no arguments it lists every checkpoint (the span it replaced, its token price, and the summary the model reads in its place), and with `from`/`to` it reads one span back as a bounded transcript. Reads go through `ctx.sessionQuery`, so the tool never touches a storage backend or a live session's internals. Choose it where a session compacts long history and the work still needs the original words.

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

Mount this plugin beside the tool registry and a session-query backend; the shipped `dsh-base` composition mounts both, so one inserted row adds the tool.

### Command reference

| Input | Result |
|---|---|
| `history_read({})` | Lists every compaction checkpoint: seq, replaced span, token price, and the summary that replaced it |
| `history_read({ from, to })` | Reads that span back as a transcript of `user`, `system`, `assistant`, tool-call, and tool-result lines |

A span read is bounded three ways: at most `maxEvents` events, at most `maxEventChars` characters per event, and at most `maxBytes` bytes for the whole transcript. A bounded result ends with an omission notice naming what was dropped.

### When the model should reach for it

The checkpoint list says whether compaction replaced anything and which span to read. The transcript is the original log content, so it recovers exact wording, numbers, and tool arguments that a summary compressed away. It is not a search tool: to find one event use `session_event_read`, and to search prior sessions use `session_search`.

### Compose it

```yaml
- insert:
    - id: tool-history-read
      name: '@deepseek-ai/dsh-experimental-tool-history-read'
      config:
        maxBytes: 8000
        maxEvents: 200
        maxEventChars: 2000
```

From a repository checkout, apply such an overlay with `dsh web --patch <file>`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The tool is a reader, not a store: `compaction/summary` events already carry the replaced span (`shadowedRange`) and its summary, and the durable log still holds every original event. One `sessionQuery.readSession()` call therefore serves both modes — the list filters those events, and a span read slices them — so the tool owns only validation, rendering, and bounds. Rendering reuses `TextRetainer`, the shared byte-budget accumulator, so a transcript is cut at a character boundary and reports its exact omitted byte count.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the `history_read` tool, mode dispatch, range validation, bounds config |
| [`src/transcript.ts`](src/transcript.ts) | Checkpoint extraction, per-event lines, checkpoint index, bounded span rendering |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

The package is a thin reader over existing seams; read these pages for the mechanisms it uses.

- [Session query service](../../session-query/session-query/README.md) — the live-preferred read seam this tool calls.
- [Compaction package](../../compaction/compaction/README.md) — the summary event and shadow-price protocol the checkpoint list reads.
- [Session subsystem](../../../docs/subsystems/session.md) — the event log and surface the transcript renders.
- [Recallable compaction](../../../.agents/notes/proposed/feature/2026-07-06-recallable-compaction.md) — the proposed design this tool is the first slice of.

-----

<a id="model-experience"></a>
## Model Experience

### Recalled compaction history

#### What the model sees

Only what a call returns. The index mode returns the fixed header `Compaction replaced this history. Read a span with history_read({ from, to }):` followed by one line per checkpoint — `checkpoint #<seq> replaced events #<start>–<end> (<count> events, <tokens> tokens): <summary>` — or the fixed sentence `No compaction has removed history from this session: every event is still in your current view.` The read mode returns one line per content-bearing event, labelled `user:`, `system:`, `assistant:`, `tool call <name>(<arguments>)`, or `tool result:`, followed when bounded by `Omitted <n> later events.` and `Omitted <n> bytes.`

#### Token effect

Zero tokens until the model calls it. A successful call adds its returned text to the retained history and resends it on later steps, so an unnecessarily wide span costs tokens on every following request.

#### KV Cache effect

Append-only: a tool call and its result follow the reusable request prefix, so nothing already cached is invalidated.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the tool is the wrong choice. They are current package constraints, not a task backlog.

- **Summarizing compactions only** — tool-result prunes and image offloads replace history through their own events and are not listed.
- **The index is pull-only** — no checkpoint pointer rides the summary text the model already reads, so the model must call the tool to learn that history was replaced.
- **No pagination** — one call returns at most `maxEvents`/`maxBytes`; narrowing the range is the caller's job.
- **A query backend must be mounted** — the tool injects `ctx.sessionQuery`, which a composition provides through a backend such as `dsh-session-query-sqlite`.
- **Attachments render as nothing** — image and file blocks contribute no transcript line.
- **No UI presentation** — the call renders through the generic tool card.
- **Package-level tests only** — a Loader real-composition test and a recorded-session snapshot are still owed by the [testing policy](../../../docs/testing.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Open, undecided: folding the checkpoint index into the summary text itself, reading spans through an asynchronous paginated read instead of one whole-log load, and listing prune and image-offload replacements alongside summaries.

</details>

**Runtime invariant:** No companion is published. Reads go through `ctx.sessionQuery`, which owns and checks the stored history this tool never indexes itself.
