---
description: "The experimental show_task_surface tool that presents one structured Task Surface panel and ends the turn for the user to answer it."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-tool-task-surface

English | [中文](README.zh.md)

## Summary

`dsh-experimental-tool-task-surface` gives the model one stable tool, `show_task_surface`, for interactions that read better as one structured panel than as alternating prose: a comparison table, a set of options, or a small group of related fields. The call publishes `TaskSurfaceModelV1`, the client renders it, and a successful call ends the turn so the agent stops at the requested human checkpoint. The user's submission arrives as their next ordinary message. Choose it when the durable result is the user's conclusion, not the panel itself.

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

Mount this plugin beside the tool registry; the tool needs no service beyond `ctx.tools`. The Web panel is a separate opt-in package, [client-ui-task-surface](../client-ui-task-surface/README.md), so a Host without it still advertises the tool — the model's result text then explains that the user answers in conversation instead.

### Declared model

| Part | Supported values |
|---|---|
| `sections[]` | `id`, optional `title`, optional `layout` (`stack`, or `grid` with 2–3 columns), `blocks[]` |
| blocks | `markdown` (images render as alt text only), `metrics`, `table` (rows keyed by column id), `notice` (`neutral`/`info`/`warning`) |
| `fields[]` | `text` (single or `multiline`, optional `required` and `initial`), `choice`, `multi-choice`, `toggle` |
| `submit` | `{ label }` |

Arguments the declared schema does not contain are rejected before execution, so an unsupported field kind fails the call instead of rendering a partial panel.

### Limits

| Bound | Value |
|---|---|
| Whole model | 64 KiB |
| Sections | 12 |
| Blocks per section | 8 |
| Fields | 24 |
| Table rows | 200 |

A violation is an `INVALID_ARGS` failure the model can retry within the same turn.

### Compose it

```yaml
- insert:
    - id: tool-task-surface
      name: '@deepseek-ai/dsh-experimental-tool-task-surface'
```

From a repository checkout, apply such an overlay with `dsh web --patch <file>`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The tool owns exactly three things and delegates the rest. One `defineTool` declaration is the whole contract: the schema validates and narrows the model, so the body never re-parses it. The body then bounds the model, mints the panel's content address (`sha256` of the logged arguments, first 16 hexadecimal characters — the same arguments always name the same panel, so a reload and a re-post agree), and calls `exec.concludeTurn()` so the agent cannot continue past the human checkpoint. `isConcurrencySafe` stays omitted: under the tool-registry contract that classifies every call as an exclusive ordering barrier, which is what a turn-ending presentation needs. Nothing is stored: the panel is replayable from the call's own logged arguments, which is also what the Web row reads.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the model schema, the size policy, the surface id, and `show_task_surface` |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Task Surface for structured session interaction](../../../.agents/notes/proposed/feature/2026-08-04-task-surface.md) — the proposed design this tool is the first slice of.
- [Canonical tool output contract](../../../.agents/notes/implemented/architecture/2026-07-20-canonical-tool-output-contract.md) — why the result value stays execution-local.
- [Adding a tool](../../../docs/cookbook/adding-a-tool.md) — the declaration style this package follows.

-----

<a id="model-experience"></a>
## Model Experience

### Task Surface presentation

#### What the model sees

Its own call arguments, then the result text the tool returns once the turn ends.

##### Result text

```markdown
Task Surface "<title>" (<surfaceId>) is open in the panel. The turn ended here: submit the panel to answer it, or send an ordinary message to bypass it and put the panel aside. Do not restate the panel in prose.
```

#### Token effect

One declaration in every request, independent of the task-specific model, plus the result text once per panel. The panel's own content never enters the prompt: the model knows what it sent, and the user's answers arrive as one ordinary message.

#### KV Cache effect

Append-only: the tool call and its result extend the reusable prefix, and the model never resends the panel.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the tool is the wrong choice. They are current package constraints, not a task backlog.

- **The panel lives in the call arguments** — the proposed `presentationMeta` normalization and the Host projection are deferred, so a re-post of a changed model is a new panel rather than an update.
- **One panel per call, no lifecycle** — no active-Surface check, dismissal event, or submission record; an ordinary user message is the whole bypass, and a second call simply opens a second panel.
- **No `order` field kind** — reorderable lists are outside this slice, and the declared schema rejects them.
- **No `diff` block** — the other declared block kind is deferred.
- **No render intent** — the panel appears only where a client registers the keyed Tool view.
- **Package-level tests only** — a Loader real-composition test and a recorded-session snapshot are still owed by the [testing policy](../../../docs/testing.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Open, undecided: whether the size policy belongs in the schema (JSON Schema `maxItems`/`maxLength`) instead of the body, and whether the surface id should hash the normalized model rather than the logged arguments.

</details>
