/**
 * One Task Surface panel: the declared content blocks, the declared input
 * fields, and the single submit control. Both mounts render this — the keyed
 * transcript row as a read-only replay, the input dock as the editor — so the
 * two never disagree about what the panel says.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-task-surface/client
 */

import { useState, type FormEvent, type ReactNode } from 'react'
import { MarkdownText, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  altOnly, awaitingRequired, formatSubmission, idsOf, initialValues,
  type FieldValue, type SurfaceBlock, type SurfaceField, type SurfaceModel,
} from './model.ts'
import type { TaskSurfaceCardProps } from './TaskSurfaceCard.tsx'
import css from './TaskSurfaceCard.module.css'

/** Props of the shared panel body. */
export interface TaskSurfacePanelProps {
  /** The validated panel. */
  readonly model: SurfaceModel
  /** Panel copy. */
  readonly t: TaskSurfaceCardProps['t']
  /** Send the formatted submission as one ordinary user message. */
  readonly submit: (text: string) => Promise<void>
  /** Prefix making every declared field id unique on the page. */
  readonly idPrefix: string
  /** Render the panel as a replay: inputs disabled, no submit control. */
  readonly readOnly?: boolean
  /** Extra controls beside the submit control, in the actions row. */
  readonly actions?: ReactNode
}

/** Panel phase: the form is editable, awaiting the send, or accepted. */
type Phase = 'editing' | 'sending' | 'sent'

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

/** One editable field (a disabled control while the panel is a replay). */
function Field({
  field, value, disabled, idPrefix, onChange,
}: {
  readonly field: SurfaceField
  readonly value: FieldValue | undefined
  readonly disabled: boolean
  readonly idPrefix: string
  readonly onChange: (value: FieldValue) => void
}): ReactNode {
  const inputId = `${idPrefix}-${field.id}`
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
    const selected = multiple ? idsOf(value) : [typeof value === 'string' ? value : '']
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
  const text = typeof value === 'string' ? value : ''
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
 * Render one validated panel.
 * @param props - the panel model, its copy, the submission writer, and the mount's options.
 * @returns the panel content and, unless read-only, its form.
 */
export function TaskSurfacePanel(props: TaskSurfacePanelProps): ReactNode {
  const { model, t, submit, idPrefix, readOnly = false, actions } = props
  const [overrides, setOverrides] = useState<Record<string, FieldValue>>({})
  const [phase, setPhase] = useState<Phase>('editing')
  const [failure, setFailure] = useState<string | null>(null)
  const values = { ...initialValues(model.fields ?? []), ...overrides }
  const labels: MarkdownLabels = { code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }
  const disabled = readOnly || phase !== 'editing'
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
    <>
      {model.description !== undefined && <p className={css.description}>{model.description}</p>}
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
              idPrefix={idPrefix}
              onChange={(value) => { setOverrides(current => ({ ...current, [field.id]: value })) }}
            />
          ))}
          {!readOnly && (
            <div className={css.actions}>
              <button className={css.submit} type="submit" disabled={disabled || held}>
                {model.submit.label}
              </button>
              {phase === 'sending' && <span className={css.status} role="status">{t('state.sending')}</span>}
              {phase === 'sent' && <span className={css.status} role="status">{t('state.sent')}</span>}
              {failure !== null && <span className={css.failure} role="alert">{t('state.failed', { message: failure })}</span>}
              {actions}
            </div>
          )}
        </form>
      )}
      {readOnly && actions !== undefined && <div className={css.actions}>{actions}</div>}
    </>
  )
}
