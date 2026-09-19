---
description: "The experimental Web Task Surface panel that renders one show_task_surface call as a fillable form and submits it as one ordinary user message."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-task-surface

English | [中文](README.zh.md)

## Summary

`dsh-experimental-client-ui-task-surface` renders a `show_task_surface` call as one fillable panel inside the conversation: the declared content blocks (Markdown, metrics, table, notice) plus the declared input fields (text, choice, multi-choice, toggle), and one submit control. Submitting sends the answers as one ordinary user message, so the conclusion stays visible in the transcript and starts the next turn through the same admission path the composer uses. Choose it wherever a session shows Task Surface panels; without it, the same call falls back to the ordinary Tool result text.

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

Mount it in a Web composition that also mounts the tool: this package owns the presentation, [`tool-task-surface`](../tool-task-surface/README.md) owns the schema. It registers one keyed `tool.call.toolview` entry for the wire name `show_task_surface`, so the panel replaces the generic Tool row for that call and nothing else.

### What the user gets

- Every declared block renders in declared order; a `grid` section lays out its blocks in 2–3 columns and collapses to one column on a narrow panel.
- Image syntax in Markdown renders as its alt text only: no model-supplied URL is fetched, and no image is shown before the user activates a link themselves.
- Required text fields hold the submit control closed until they are answered; the toggle always reports its state, and unanswered optional fields are simply omitted from the submission.
- A failed submission keeps every value editable and shows the reason from the transport.

### Compose it

```yaml
- insert:
    - id: client-ui-task-surface
      name: '@deepseek-ai/dsh-experimental-client-ui-task-surface'
```

From a repository checkout, apply such an overlay with `dsh web --patch <file>`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains how the package realizes the behavior above; the observable contract is covered in [Use this package](#use-this-package).

### Design concept

The panel is a pure function of what the turn already logged. The card reads the model out of the Tool call's own arguments — the same durable slice on both the running and settled node — so a reload, a reconnect, and a scrolled-back transcript render the identical panel without a Host round trip or a second copy of the model. Parsing is strict: an unsupported version, a malformed section, or a block or field arm this slice does not render returns no panel at all, and the card shows the ordinary Tool result text instead of a partially interpreted form. The one write path is the registering plugin's injected `submit`, which resolves the business Session for the view's own scope and admits one text message in `queue` mode; the card itself never touches transport, stores, or other plugins.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: dictionaries, the keyed Tool view registration, and the submission writer |
| [`src/client/TaskSurfaceCard.tsx`](src/client/TaskSurfaceCard.tsx) | Model parsing, block and field rendering, submission formatting, form lifecycle |
| [`src/client/TaskSurfaceCard.module.css`](src/client/TaskSurfaceCard.module.css) | Panel layout and theme-token styling |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Task Surface for structured session interaction](../../../.agents/notes/proposed/feature/2026-08-04-task-surface.md) — the proposed design, including the Dock this slice does not build.
- [Tool view slot contract](../../../docs/subsystems/slots.md) — how a keyed `tool.call.toolview` entry takes over one Tool row.
- [`MarkdownText`](../../client/ui-primitives/README.md) — the shared Markdown renderer the panel reuses.
- [Session Controller client](../../api/session-controller/README.md) — the business Session whose `prompt` admits the submission.

-----

<a id="model-experience"></a>
## Model Experience

### Task Surface submission

#### What the model sees

Its own `show_task_surface` call, then — once the user submits — one ordinary user message whose text this panel formats. Nothing else about the panel reaches the prompt.

##### Submission message

```markdown
Task Surface "<title>" answers
- <field label>: <submitted value>
```

#### Token effect

None until the user submits; the formatted message then joins the retained history like any other user turn. The panel's blocks and layout never enter the prompt.

#### KV Cache effect

No direct effect: the panel renders locally and contributes no request content. The submission is an ordinary user message appended after the reusable prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the panel is not enough. They are current package constraints, not a task backlog.

- **The transcript row is the only editor** — the proposed `TaskSurfaceDock` needs the Host projection, `getActive`, and the transactional submission record; until then a panel whose result has scrolled out of the loaded window cannot be refilled.
- **No persisted drafts** — values live in component state, so a reload loses unsubmitted answers; the submitted answers survive in the user message.
- **No dismissal and no answer history** — there is no dismissal event, no `submissionId`, and no read-only replay state; the panel stays editable and a second submit is a second message.
- **Strict parsing, no partial panels** — one unsupported arm or malformed section falls back to the plain Tool result for the whole call.
- **Fixed component vocabulary** — only the four block kinds, four field kinds, and two layouts the tool declares; unknown ones are rejected before rendering.
- **Package-level tests only** — a keyless browser composition test through the real Web plugin host is still owed by the [testing policy](../../../docs/testing.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Open, undecided: whether the panel should disable itself once its call has settled, whether drafts belong in the existing per-Session slot store, and whether the alt-only image rule should move into `MarkdownText` as a policy prop so every model-authored surface shares it.

</details>
