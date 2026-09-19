/**
 * The `show_task_surface` declaration: one stable tool name, its bounded V1
 * model subset, and the replayable presentation metadata that makes the panel
 * recoverable from the log.
 *
 * @module @deepseek-ai/dsh-experimental-tool-task-surface/tool
 */

import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { defineTool, ToolArgsError } from '@deepseek-ai/dsh-tools'
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import { TASK_SURFACE_META_KIND, TASK_SURFACE_TOOL_NAME } from './meta.ts'

export { TASK_SURFACE_TOOL_NAME }

/** Model-facing description of the panel interaction, including its bypass rule. */
const description = 'Present one structured Task Surface panel — content sections plus optional input '
  + 'fields — and end the turn for the user to fill it in. Use it when a comparison table, a set of '
  + 'options, or a small group of related fields explains the decision better than prose. The user\'s '
  + 'submission arrives as their next message; do not repeat the panel\'s content in chat.'

/** Bounded-size policy for one panel; the byte cap bounds log, DOM, and prompt cost together. */
const LIMITS = {
  modelBytes: 64 * 1024,
  sections: 12,
  blocksPerSection: 8,
  fields: 24,
  tableRows: 200,
} as const

/** One walked block: only a table arm declares rows, so the shape stays optional here. */
interface BoundedBlock {
  readonly kind: string
  readonly rows?: readonly unknown[]
}

/** The model slice the size policy walks. The declared arguments satisfy it structurally. */
interface BoundedModel {
  readonly sections: readonly {
    readonly id: string
    readonly blocks: readonly BoundedBlock[]
  }[]
  readonly fields?: readonly unknown[]
}

/** The rows one walked block declares; only a table arm declares any. */
function declaredRows(block: BoundedBlock): readonly unknown[] {
  return block.rows ?? []
}

/** One option a choice, multi-choice, or order field offers. */
const option = {
  type: 'object',
  additionalProperties: false,
  description: 'One selectable option.',
  properties: {
    id: { type: 'string', required: true, description: 'Stable option id; echoed in the submission.' },
    label: { type: 'string', required: true, description: 'Short user-facing option label.' },
    detail: { type: 'string', description: 'One sentence explaining the option.' },
  },
} satisfies ValueSchemaSpec

/** Declarative markup block rendered through the client's Markdown renderer. */
const markdownBlock = {
  type: 'object',
  additionalProperties: false,
  description: 'A Markdown passage. Images render as their alt text only.',
  properties: {
    kind: { type: 'string', required: true, const: 'markdown', description: 'Block discriminator.' },
    text: { type: 'string', required: true, description: 'Markdown source.' },
  },
} satisfies ValueSchemaSpec

/** Label/value pairs rendered as a compact metric row. */
const metricsBlock = {
  type: 'object',
  additionalProperties: false,
  description: 'Labeled values, for totals or comparisons the prose would bury.',
  properties: {
    kind: { type: 'string', required: true, const: 'metrics', description: 'Block discriminator.' },
    items: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string', required: true, description: 'Metric label.' },
          value: { type: 'string', required: true, description: 'Metric value as display text.' },
          detail: { type: 'string', description: 'Optional qualifier under the value.' },
        },
      },
    },
  },
} satisfies ValueSchemaSpec

/** Tabular rows addressed by column id; each cell is any lossless JSON scalar or null. */
const tableBlock = {
  type: 'object',
  additionalProperties: false,
  description: 'A table whose rows address columns by id.',
  properties: {
    kind: { type: 'string', required: true, const: 'table', description: 'Block discriminator.' },
    columns: {
      type: 'array',
      required: true,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true, description: 'Column id used as the row key.' },
          label: { type: 'string', required: true, description: 'Column heading.' },
        },
      },
    },
    rows: {
      type: 'array',
      required: true,
      description: 'Rows keyed by column id; a missing cell renders as empty.',
      items: { type: 'json' },
    },
  },
} satisfies ValueSchemaSpec

/** One emphasized sentence carrying a tone. */
const noticeBlock = {
  type: 'object',
  additionalProperties: false,
  description: 'A short callout.',
  properties: {
    kind: { type: 'string', required: true, const: 'notice', description: 'Block discriminator.' },
    tone: {
      type: 'string',
      required: true,
      enum: ['neutral', 'info', 'warning'],
      description: 'Visual weight of the callout.',
    },
    text: { type: 'string', required: true, description: 'Callout text.' },
  },
} satisfies ValueSchemaSpec

/** One single-line or multi-line text input. */
const textField = {
  type: 'object',
  additionalProperties: false,
  description: 'A free-text input.',
  properties: {
    kind: { type: 'string', required: true, const: 'text', description: 'Field discriminator.' },
    id: { type: 'string', required: true, description: 'Stable field id; echoed in the submission.' },
    label: { type: 'string', required: true, description: 'Field label.' },
    multiline: { type: 'boolean', description: 'Render a growing multi-line editor instead of one line.' },
    required: { type: 'boolean', description: 'Mark the field required; the user cannot submit it empty.' },
    initial: { type: 'string', description: 'Value the editor starts with.' },
  },
} satisfies ValueSchemaSpec

/** One exclusive choice among options. */
const choiceField = {
  type: 'object',
  additionalProperties: false,
  description: 'A single-choice input.',
  properties: {
    kind: { type: 'string', required: true, const: 'choice', description: 'Field discriminator.' },
    id: { type: 'string', required: true, description: 'Stable field id; echoed in the submission.' },
    label: { type: 'string', required: true, description: 'Field label.' },
    options: { type: 'array', required: true, description: 'Selectable options.', items: option },
    initial: { type: 'string', description: 'Option id selected first.' },
  },
} satisfies ValueSchemaSpec

/** One inclusive choice among options. */
const multiChoiceField = {
  type: 'object',
  additionalProperties: false,
  description: 'A multiple-choice input.',
  properties: {
    kind: { type: 'string', required: true, const: 'multi-choice', description: 'Field discriminator.' },
    id: { type: 'string', required: true, description: 'Stable field id; echoed in the submission.' },
    label: { type: 'string', required: true, description: 'Field label.' },
    options: { type: 'array', required: true, description: 'Selectable options.', items: option },
    initial: { type: 'array', description: 'Option ids selected first.', items: { type: 'string' } },
  },
} satisfies ValueSchemaSpec

/** One boolean switch. */
const toggleField = {
  type: 'object',
  additionalProperties: false,
  description: 'A boolean input.',
  properties: {
    kind: { type: 'string', required: true, const: 'toggle', description: 'Field discriminator.' },
    id: { type: 'string', required: true, description: 'Stable field id; echoed in the submission.' },
    label: { type: 'string', required: true, description: 'Field label.' },
    initial: { type: 'boolean', description: 'State the switch starts in.' },
  },
} satisfies ValueSchemaSpec

/** Section flow: a plain stack, or a fixed-column grid that collapses when narrow. */
const layout = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      description: 'Sections stacked in order.',
      properties: {
        kind: { type: 'string', required: true, const: 'stack', description: 'Layout discriminator.' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      description: 'Sections laid out in two or three columns.',
      properties: {
        kind: { type: 'string', required: true, const: 'grid', description: 'Layout discriminator.' },
        columns: { type: 'number', required: true, enum: [2, 3], description: 'Grid column count.' },
      },
    },
  ],
} satisfies ValueSchemaSpec

const parameters = {
  model: {
    type: 'object',
    required: true,
    additionalProperties: false,
    description: 'The complete Task Surface model to present.',
    properties: {
      version: { type: 'number', required: true, const: 1, description: 'Protocol version; must be 1.' },
      title: { type: 'string', required: true, description: 'Panel title, one short line.' },
      description: { type: 'string', description: 'Optional introduction shown above the sections.' },
      sections: {
        type: 'array',
        required: true,
        description: 'Ordered content sections; an empty array is allowed for an fields-only panel.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Stable section id, unique in the model.' },
            title: { type: 'string', description: 'Optional section heading.' },
            layout: { ...layout, description: 'How this section lays out its blocks; defaults to stack.' },
            blocks: {
              type: 'array',
              required: true,
              description: 'Blocks rendered in order.',
              items: { oneOf: [markdownBlock, metricsBlock, tableBlock, noticeBlock] },
            },
          },
        },
      },
      fields: {
        type: 'array',
        description: 'Input fields rendered as one form under the sections.',
        items: { oneOf: [textField, choiceField, multiChoiceField, toggleField] },
      },
      submit: {
        type: 'object',
        required: true,
        additionalProperties: false,
        description: 'The single submit control.',
        properties: {
          label: { type: 'string', required: true, description: 'Submit button label, such as "Approve plan".' },
        },
      },
    },
  },
} as const

/**
 * Collect the limit violations of one model that passed argument validation.
 * @param model - validated model.
 * @returns one message per violated limit, empty when the model is within policy.
 */
function limitViolations(model: BoundedModel): string[] {
  const violations: string[] = []
  const bytes = Buffer.byteLength(JSON.stringify(model), 'utf8')
  if (bytes > LIMITS.modelBytes) {
    violations.push(`model is ${bytes} bytes, the limit is ${LIMITS.modelBytes}`)
  }
  if (model.sections.length > LIMITS.sections) {
    violations.push(`model has ${model.sections.length} sections, the limit is ${LIMITS.sections}`)
  }
  const fields = model.fields?.length ?? 0
  if (fields > LIMITS.fields) {
    violations.push(`model has ${fields} fields, the limit is ${LIMITS.fields}`)
  }
  for (const section of model.sections) {
    if (section.blocks.length > LIMITS.blocksPerSection) {
      violations.push(`section "${section.id}" has ${section.blocks.length} blocks, the limit is ${LIMITS.blocksPerSection}`)
    }
    for (const block of section.blocks) {
      const rows = declaredRows(block).length
      if (rows > LIMITS.tableRows) {
        violations.push(`a table in section "${section.id}" has ${rows} rows, the limit is ${LIMITS.tableRows}`)
      }
    }
  }
  return violations
}

/**
 * Content address of one model: the same call arguments always name the same
 * panel, which is what lets a replay, a reload, and a re-post agree on it.
 * @param model - the validated model exactly as logged.
 * @returns short hexadecimal surface id.
 */
function surfaceIdOf(model: unknown): string {
  return createHash('sha256').update(JSON.stringify(model)).digest('hex').slice(0, 16)
}

/** The registered Task Surface tool. */
export const taskSurfaceTool = defineTool({
  name: TASK_SURFACE_TOOL_NAME,
  description,
  parameters,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        surfaceId: { type: 'string', required: true },
      },
    },
    render: (args, value) => [{
      type: 'text',
      text: `Task Surface "${args.model.title}" (${value.surfaceId}) is open in the panel. `
        + 'The turn ended here: submit the panel to answer it, or send an ordinary message to bypass it '
        + 'and put the panel aside. Do not restate the panel in prose.',
    }],
    // The canonical model rides the result, so a replay (and a client that
    // never saw the call) reads the panel back instead of re-deriving it.
    presentationMeta: (args, value) => ({
      kind: TASK_SURFACE_META_KIND,
      version: 1,
      surfaceId: value.surfaceId,
      model: args.model,
    }),
  },
  execute(args, exec) {
    const violations = limitViolations(args.model)
    if (violations.length > 0) throw new ToolArgsError(violations)
    exec.concludeTurn()
    return Promise.resolve({ surfaceId: surfaceIdOf(args.model) })
  },
})
