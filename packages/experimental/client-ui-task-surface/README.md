---
description: "The experimental Web Task Surface panel that renders one show_task_surface call as a fillable form and submits it as one ordinary user message."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-task-surface

English | [中文](README.zh.md)

## Summary

`dsh-experimental-client-ui-task-surface` renders a `show_task_surface` call in two mounts: an input dock above the composer is the editor, and the transcript's keyed Tool row is a read-only replay. Both read the Host's `taskSurface` projection and the logged call arguments, so a refresh or a reconnect recovers the same panel. Submitting sends one ordinary user message; dismissing appends one durable log event.

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

- An open panel appears in the input dock above the composer, titled with the panel's own title, with one dismiss control beside it. The dock is the only editor; the transcript row replays the same panel read-only.
- Dismissing appends one durable log event through `/task-surface dismiss <surfaceId>`, so the panel stays closed after a reload and across clients. Any ordinary message the user sends instead closes it too, which is the documented bypass.
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

The panel is a pure function of what the log already holds. The dock reads the Host's `taskSurface` projection — identity plus the model exactly as logged — so it stays actionable while the opening call sits outside the loaded history; the row reads the Tool call's own arguments, the durable slice that both the running and settled node carry. Both parse strictly: an unsupported version, a malformed section, or a block or field arm this slice does not render returns no panel at all, and that mount shows the ordinary Tool result text instead of a partially interpreted form. The two write paths are the registering plugin's injected verbs: `submit` resolves the business Session for the view's own scope and admits one text message in `queue` mode, and `dismiss` runs the Host command whose log event closes the projection. Neither component touches transport, stores, or other plugins.

### Source map

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Browser plugin: dictionaries, both registrations, and the submission and dismissal verbs |
| [`src/client/TaskSurfaceDock.tsx`](src/client/TaskSurfaceDock.tsx) | The editor: projection read, panel mount, dismissal |
| [`src/client/TaskSurfaceCard.tsx`](src/client/TaskSurfaceCard.tsx) | The keyed read-only replay of one logged call |
| [`src/client/TaskSurfacePanel.tsx`](src/client/TaskSurfacePanel.tsx) | Shared panel body: blocks, fields, form lifecycle, actions row |
| [`src/client/model.ts`](src/client/model.ts) | Model types, strict parsing, initial values, submission formatting |
| [`src/client/TaskSurfaceCard.module.css`](src/client/TaskSurfaceCard.module.css) | Panel and dock layout with theme-token styling |

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

- **A client without the dock cannot fill a panel** — the row is read-only by design (one draft owner), so a composition that mounts only this package's Tool row shows the panel without an editor; the ordinary-message bypass still works.
- **No persisted drafts** — values live in component state, so a reload loses unsubmitted answers; the submitted answers survive in the user message.
- **No submission record** — there is no `submissionId`, no transactional claim, and no queue coordination: a double submit is two messages, and a dismissal is not idempotent by id.
- **No collapse** — the proposed dock collapse (local view state) is not built; the panel is dismissed or left open.
- **Strict parsing, no partial panels** — one unsupported arm or malformed section falls back to the plain Tool result for the whole call.
- **Fixed component vocabulary** — only the four block kinds, four field kinds, and two layouts the tool declares; unknown ones are rejected before rendering.
- **Package-level tests only** — a keyless browser composition test through the real Web plugin host is still owed by the [testing policy](../../../docs/testing.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Open, undecided: whether the panel should disable itself once its call has settled, whether drafts belong in the existing per-Session slot store, and whether the alt-only image rule should move into `MarkdownText` as a policy prop so every model-authored surface shares it.

</details>
