/**
 * The Task Surface model as this renderer consumes it, plus the pure reads and
 * formatting both mounts share: the keyed transcript row parses the logged call
 * arguments, the dock parses the projection's model value, and both format the
 * user's answers into one ordinary message.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-task-surface/client
 */

import type { TaskSurfaceCardProps } from './TaskSurfaceCard.tsx'

/** One selectable option. */
export interface SurfaceOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

/** One content block of the model subset this slice renders. */
export type SurfaceBlock =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'metrics'; readonly items: readonly { label: string; value: string; detail?: string }[] }
  | {
    readonly kind: 'table'
    readonly columns: readonly { id: string; label: string }[]
    readonly rows: readonly Record<string, unknown>[]
  }
  | { readonly kind: 'notice'; readonly tone: 'neutral' | 'info' | 'warning'; readonly text: string }

/** One input field of the model subset this slice renders. */
export type SurfaceField =
  | {
    readonly kind: 'text'
    readonly id: string
    readonly label: string
    readonly multiline?: boolean
    readonly required?: boolean
    readonly initial?: string
  }
  | { readonly kind: 'choice'; readonly id: string; readonly label: string; readonly options: readonly SurfaceOption[]; readonly initial?: string }
  | { readonly kind: 'multi-choice'; readonly id: string; readonly label: string; readonly options: readonly SurfaceOption[]; readonly initial?: readonly string[] }
  | { readonly kind: 'toggle'; readonly id: string; readonly label: string; readonly initial?: boolean }

/** One content section. */
export interface SurfaceSection {
  readonly id: string
  readonly title?: string
  readonly layout?: { readonly kind: 'stack' } | { readonly kind: 'grid'; readonly columns: 2 | 3 }
  readonly blocks: readonly SurfaceBlock[]
}

/**
 * The V1 model as this renderer consumes it. The Tool declaration in
 * `packages/experimental/tool-task-surface` is the source of truth for what a
 * model may send; this interface only names the arms that got here.
 */
export interface SurfaceModel {
  readonly title: string
  readonly description?: string
  readonly sections: readonly SurfaceSection[]
  readonly fields?: readonly SurfaceField[]
  readonly submit: { readonly label: string }
}

/** The value one field currently holds, in the shape its arm declares. */
export type FieldValue = string | readonly string[] | boolean

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isText = (value: unknown): value is string => typeof value === 'string'

const isOption = (value: unknown): value is SurfaceOption =>
  isRecord(value) && isText(value.id) && isText(value.label)

/** Whether one value is a block arm this renderer owns. */
function isBlock(value: unknown): value is SurfaceBlock {
  if (!isRecord(value)) return false
  if (value.kind === 'markdown') return isText(value.text)
  if (value.kind === 'notice') {
    return isText(value.text) && (value.tone === 'neutral' || value.tone === 'info' || value.tone === 'warning')
  }
  if (value.kind === 'metrics') {
    return Array.isArray(value.items)
      && value.items.every(item => isRecord(item) && isText(item.label) && isText(item.value))
  }
  if (value.kind === 'table') {
    return Array.isArray(value.columns)
      && value.columns.every(column => isRecord(column) && isText(column.id) && isText(column.label))
      && Array.isArray(value.rows)
      && value.rows.every(isRecord)
  }
  return false
}

/** Whether one value is a field arm this renderer owns. */
function isField(value: unknown): value is SurfaceField {
  if (!isRecord(value) || !isText(value.id) || !isText(value.label)) return false
  if (value.kind === 'text' || value.kind === 'toggle') return true
  if (value.kind === 'choice' || value.kind === 'multi-choice') {
    return Array.isArray(value.options) && value.options.every(isOption)
  }
  return false
}

/** Whether one value is a section this renderer owns. */
function isSection(value: unknown): value is SurfaceSection {
  return isRecord(value) && isText(value.id) && Array.isArray(value.blocks) && value.blocks.every(isBlock)
}

/**
 * Read a panel out of one model value — the logged call's `model` property or
 * the projection's `active.model`. Strict on the spine and on every arm: an
 * unsupported version, a malformed section, or an arm this slice does not
 * render returns `null` so the mount falls back to the ordinary Tool result
 * instead of showing a partial panel.
 * @param value - the declared model value.
 * @returns the parsed model, or `null` when this renderer cannot own it.
 */
export function parseSurfaceModelValue(value: unknown): SurfaceModel | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (!isText(value.title) || !isRecord(value.submit) || !isText(value.submit.label)) return null
  if (!Array.isArray(value.sections) || !value.sections.every(isSection)) return null
  if (value.fields !== undefined && (!Array.isArray(value.fields) || !value.fields.every(isField))) return null
  return {
    title: value.title,
    ...value.description === undefined || !isText(value.description) ? {} : { description: value.description },
    sections: value.sections,
    ...value.fields === undefined ? {} : { fields: value.fields },
    submit: { label: value.submit.label },
  }
}

/**
 * Read a panel out of one logged `tool/call` argument string.
 * @param argsRaw - the call's argument JSON as logged, possibly still streaming.
 * @returns the parsed model, or `null` while the call is not a complete panel.
 */
export function parseSurfaceModel(argsRaw: string): SurfaceModel | null {
  let payload: unknown
  try {
    payload = JSON.parse(argsRaw)
  } catch {
    // A streaming call exposes a truncated JSON prefix; it is not a panel yet.
    return null
  }
  return isRecord(payload) ? parseSurfaceModelValue(payload.model) : null
}

/**
 * The option ids one multi-choice value holds; any other shape holds none.
 * @param value - one stored field value.
 * @returns the id strings it holds.
 */
export function idsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(id => String(id)) : []
}

/**
 * Starting values for every declared field.
 * @param fields - the panel's declared fields.
 * @returns one value per field id, in the shape its arm declares.
 */
export function initialValues(fields: readonly SurfaceField[]): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {}
  for (const field of fields) {
    if (field.kind === 'text' || field.kind === 'choice') values[field.id] = field.initial ?? ''
    else if (field.kind === 'multi-choice') values[field.id] = idsOf(field.initial)
    else values[field.id] = field.initial ?? false
  }
  return values
}

/** The label a submitted option id stands for; an unknown id stands for itself. */
function optionLabel(field: { readonly options: readonly SurfaceOption[] }, id: string): string {
  return field.options.find(option => option.id === id)?.label ?? id
}

/** One field's submitted value as display text, empty when nothing was entered. */
function displayValue(field: SurfaceField, value: FieldValue | undefined, t: TaskSurfaceCardProps['t']): string {
  if (field.kind === 'multi-choice') return idsOf(value).map(id => optionLabel(field, id)).join(', ')
  if (field.kind === 'toggle') return t(value === true ? 'value.yes' : 'value.no')
  if (field.kind === 'choice') return isText(value) ? optionLabel(field, value) : ''
  return isText(value) ? value.trim() : ''
}

/**
 * The deterministic user message one submission becomes: the panel title, then
 * every answered field as one labeled line. Unanswered optional fields are
 * omitted rather than sent as empty values.
 * @param model - the validated panel.
 * @param values - current field values.
 * @param t - panel copy.
 * @returns one readable message body.
 */
export function formatSubmission(
  model: SurfaceModel,
  values: Record<string, FieldValue>,
  t: TaskSurfaceCardProps['t'],
): string {
  const lines = [t('submission.header', { title: model.title })]
  for (const field of model.fields ?? []) {
    const text = displayValue(field, values[field.id], t)
    if (text !== '') lines.push(`- ${field.label}: ${text}`)
  }
  return lines.join('\n')
}

/**
 * Whether a required field is still unanswered, which holds the submit control closed.
 * @param model - the validated panel.
 * @param values - current field values.
 * @returns true while any required field is empty.
 */
export function awaitingRequired(model: SurfaceModel, values: Record<string, FieldValue>): boolean {
  return (model.fields ?? []).some((field) => {
    if (field.kind !== 'text' || field.required !== true) return false
    const value = values[field.id]
    return !isText(value) || value.trim() === ''
  })
}

/**
 * Image syntax renders as its alt text only: no model-supplied URL is fetched
 * or shown as an image before the user activates it themselves.
 * @param text - one markdown block.
 * @returns markdown source with every image replaced by its alt text.
 */
export function altOnly(text: string): string {
  return text.replaceAll(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
}
