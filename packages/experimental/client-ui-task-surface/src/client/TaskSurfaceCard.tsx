/**
 * One fillable Task Surface panel rendered from the logged `show_task_surface`
 * call arguments — the durable, replay-safe slice the transcript already keeps.
 *
 * This package is the first Web slice of
 * `.agents/notes/proposed/feature/2026-08-04-task-surface.md`: the panel is the
 * editor and the submission is one ordinary user message. The proposed
 * `TaskSurfaceDock` (which needs the Host projection, `getActive`, and the
 * transactional submission record), dismissal, per-Session drafts, and
 * `order`/`diff` model arms are later slices.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-task-surface/client
 */

import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TaskSurfaceCard.module.css'

/**
 * The panel's only write path, supplied by the registering plugin: format one
 * submission into the user message that starts the next turn.
 */
export interface TaskSurfaceInjected {
  /** Send the formatted submission as one ordinary user message. */
  readonly submit: (text: string) => Promise<void>
}

/** Full props of the keyed `show_task_surface` Tool view. */
export type TaskSurfaceCardProps = ToolCallViewProps & PropsLocale<'taskSurface'> & TaskSurfaceInjected

/** One selectable option. */
interface SurfaceOption {
  readonly id: string
  readonly label: string
  readonly detail?: string
}

/** One content block of the model subset this slice renders. */
type SurfaceBlock =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'metrics'; readonly items: readonly { label: string; value: string; detail?: string }[] }
  | {
    readonly kind: 'table'
    readonly columns: readonly { id: string; label: string }[]
    readonly rows: readonly Record<string, unknown>[]
  }
  | { readonly kind: 'notice'; readonly tone: 'neutral' | 'info' | 'warning'; readonly text: string }

/** One input field of the model subset this slice renders. */
type SurfaceField =
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
interface SurfaceSection {
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
interface SurfaceModel {
  readonly title: string
  readonly description?: string
  readonly sections: readonly SurfaceSection[]
  readonly fields?: readonly SurfaceField[]
  readonly submit: { readonly label: string }
}

/** The value one field currently holds, in the shape its arm declares. */
type FieldValue = string | readonly string[] | boolean

/** Panel phase: the form is editable, awaiting the send, or accepted. */
type Phase = 'editing' | 'sending' | 'sent'

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
 * Read the panel out of the Tool call's logged arguments. Strict on the spine
 * and on every arm: an unsupported version, a malformed section, or an arm
 * this slice does not render returns `null` so the card falls back to the
 * ordinary Tool result instead of showing a partial panel.
 * @param argsRaw - the call's argument JSON as logged, possibly still streaming.
 * @returns the parsed model, or `null` when this renderer cannot own the call.
 */
export function parseSurfaceModel(argsRaw: string): SurfaceModel | null {
  let payload: unknown
  try {
    payload = JSON.parse(argsRaw)
  } catch {
    // A streaming call exposes a truncated JSON prefix; it is not a panel yet.
    return null
  }
  if (!isRecord(payload) || !isRecord(payload.model)) return null
  const model = payload.model
  if (payload.model.version !== 1) return null
  if (!isText(model.title) || !isRecord(model.submit) || !isText(model.submit.label)) return null
  if (!Array.isArray(model.sections) || !model.sections.every(isSection)) return null
  if (model.fields !== undefined && (!Array.isArray(model.fields) || !model.fields.every(isField))) return null
  return {
    title: model.title,
    ...model.description === undefined || !isText(model.description) ? {} : { description: model.description },
    sections: model.sections,
    ...model.fields === undefined ? {} : { fields: model.fields },
    submit: { label: model.submit.label },
  }
}

/** The option ids one multi-choice value holds; any other shape holds none. */
function idsOf(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(id => String(id)) : []
}

/** Starting values for every declared field. */
function initialValues(fields: readonly SurfaceField[]): Record<string, FieldValue> {
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
  if (field.kind === 'multi-choice') {
    return idsOf(value).map(id => optionLabel(field, id)).join(', ')
  }
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

/** Whether a required field is still unanswered, which holds the submit control closed. */
function awaitingRequired(model: SurfaceModel, values: Record<string, FieldValue>): boolean {
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
function altOnly(text: string): string {
  return text.replaceAll(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
}

/** One content block. */
function Block({ block, labels }: { readonly block: SurfaceBlock; readonly labels: MarkdownLabels }): ReactNode {
  if (block.kind === 'notice') {
    return <p className={css.notice} data-tone={block.tone}>{block.text}</p>
  }
  if (block.kind === 'metrics') {
    return (
      <dl className={css.metrics}>
        {block.items.map(item => (
          <div key={item.label} className={css.metric}>
            <dt>{item.label}</dt>
            <dd>{item.value}{item.detail !== undefined && <small>{item.detail}</small>}</dd>
          </div>
        ))}
      </dl>
    )
  }
  if (block.kind === 'table') {
    return (
      <div className={css.tableScroll}>
        <table className={css.table}>
          <thead>
            <tr>{block.columns.map(column => <th key={column.id} scope="col">{column.label}</th>)}</tr>
          </thead>
          <tbody>
            {block.rows.map((row, index) => (
              <tr key={index}>
                {block.columns.map(column => (
                  <td key={column.id}>{row[column.id] === undefined || row[column.id] === null ? '' : String(row[column.id])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <div className={css.markdown}><MarkdownText text={altOnly(block.text)} labels={labels} /></div>
}

/** One editable field. */
function Field({
  field, value, disabled, onChange,
}: {
  readonly field: SurfaceField
  readonly value: FieldValue | undefined
  readonly disabled: boolean
  readonly onChange: (value: FieldValue) => void
}): ReactNode {
  const inputId = `task-surface-${field.id}`
  if (field.kind === 'toggle') {
    return (
      <div className={css.field}>
        <label className={css.toggle} htmlFor={inputId}>
          <input
            id={inputId}
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(event) => { onChange(event.target.checked) }}
          />
          {field.label}
        </label>
      </div>
    )
  }
  if (field.kind === 'choice' || field.kind === 'multi-choice') {
    const multiple = field.kind === 'multi-choice'
    const selected = multiple ? idsOf(value) : [isText(value) ? value : '']
    return (
      <fieldset className={css.field} disabled={disabled}>
        <legend>{field.label}</legend>
        {field.options.map(option => (
          <label key={option.id} className={css.option} htmlFor={`${inputId}-${option.id}`}>
            <input
              id={`${inputId}-${option.id}`}
              type={multiple ? 'checkbox' : 'radio'}
              name={field.id}
              checked={selected.includes(option.id)}
              onChange={() => {
                onChange(multiple
                  ? selected.includes(option.id) ? selected.filter(id => id !== option.id) : [...selected, option.id]
                  : option.id)
              }}
            />
            <span>{option.label}</span>
            {option.detail !== undefined && <small>{option.detail}</small>}
          </label>
        ))}
      </fieldset>
    )
  }
  const text = isText(value) ? value : ''
  return (
    <div className={css.field}>
      <label htmlFor={inputId}>{field.label}{field.required === true && <span className={css.required} aria-hidden="true"> *</span>}</label>
      {field.multiline === true
        ? (
          <textarea
            id={inputId}
            rows={3}
            value={text}
            disabled={disabled}
            required={field.required === true}
            onChange={(event) => { onChange(event.target.value) }}
          />
        )
        : (
          <input
            id={inputId}
            type="text"
            value={text}
            disabled={disabled}
            required={field.required === true}
            onChange={(event) => { onChange(event.target.value) }}
          />
        )}
    </div>
  )
}

/**
 * Render one `show_task_surface` call. A call this renderer cannot own — still
 * streaming, unsupported version, unsupported arm — keeps the ordinary Tool
 * result text, which is the documented fallback.
 * @param props - keyed Tool view props plus the submission writer.
 * @returns the panel, or the fallback summary.
 */
export function TaskSurfaceCard(props: TaskSurfaceCardProps): ReactNode {
  const { block, t, submit } = props
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  const model = useMemo(() => parseSurfaceModel(argsRaw), [argsRaw])
  const [overrides, setOverrides] = useState<Record<string, FieldValue>>({})
  const [phase, setPhase] = useState<Phase>('editing')
  const [failure, setFailure] = useState<string | null>(null)
  const labels = useMemo<MarkdownLabels>(
    () => ({ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }),
    [t],
  )
  const values = useMemo(
    () => ({ ...initialValues(model?.fields ?? []), ...overrides }),
    [model, overrides],
  )

  if (model === null) {
    return (
      <div className={css.fallback} role="status">
        {t('state.pending')}
      </div>
    )
  }

  const disabled = phase !== 'editing'
  const held = awaitingRequired(model, values)
  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    if (disabled || held) return
    setPhase('sending')
    setFailure(null)
    void submit(formatSubmission(model, values, t)).then(
      () => { setPhase('sent') },
      (error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error))
        setPhase('editing')
      },
    )
  }

  return (
    <article className={css.surface} data-task-surface={props.callId}>
      <header className={css.header}>
        <h3 className={css.title}>{model.title}</h3>
        {model.description !== undefined && <p className={css.description}>{model.description}</p>}
      </header>
      {model.sections.map(section => (
        <section
          key={section.id}
          className={section.layout?.kind === 'grid' ? css.grid : css.stack}
          data-columns={section.layout?.kind === 'grid' ? section.layout.columns : undefined}
        >
          {section.title !== undefined && <h4 className={css.sectionTitle}>{section.title}</h4>}
          {section.blocks.map((blockItem, index) => <Block key={index} block={blockItem} labels={labels} />)}
        </section>
      ))}
      {model.fields !== undefined && model.fields.length > 0 && (
        <form className={css.form} onSubmit={onSubmit}>
          {model.fields.map(field => (
            <Field
              key={field.id}
              field={field}
              value={values[field.id]}
              disabled={disabled}
              onChange={(value) => { setOverrides(current => ({ ...current, [field.id]: value })) }}
            />
          ))}
          <div className={css.actions}>
            <button className={css.submit} type="submit" disabled={disabled || held}>
              {model.submit.label}
            </button>
            {phase === 'sending' && <span className={css.status} role="status">{t('state.sending')}</span>}
            {phase === 'sent' && <span className={css.status} role="status">{t('state.sent')}</span>}
            {failure !== null && <span className={css.failure} role="alert">{t('state.failed', { message: failure })}</span>}
          </div>
        </form>
      )}
    </article>
  )
}
