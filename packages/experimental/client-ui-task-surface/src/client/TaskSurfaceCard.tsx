/**
 * The keyed `show_task_surface` Tool view: the transcript's read-only replay of
 * one panel, rendered from the call's own logged arguments.
 *
 * The panel is a pure function of what the turn already logged, so a reload, a
 * reconnect, and a scrolled-back transcript render the same content. Editing
 * belongs to the input dock — one draft owner — which is why this row renders
 * read-only and keeps the submission writer only for the shared panel body's
 * prop contract.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-task-surface/client
 */

import { useMemo, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { parseSurfaceModel } from './model.ts'
import { TaskSurfacePanel } from './TaskSurfacePanel.tsx'
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

/**
 * Render one `show_task_surface` call as a read-only panel. A call this
 * renderer cannot own — still streaming, unsupported version, unsupported arm —
 * keeps the ordinary Tool result text, which is the documented fallback.
 * @param props - keyed Tool view props plus the submission writer.
 * @returns the panel replay, or the fallback summary.
 */
export function TaskSurfaceCard(props: TaskSurfaceCardProps): ReactNode {
  const { block, t, submit } = props
  const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? ''
  const model = useMemo(() => parseSurfaceModel(argsRaw), [argsRaw])

  if (model === null) {
    return (
      <div className={css.fallback} role="status">
        {t('state.pending')}
      </div>
    )
  }
  return (
    <article className={css.surface} data-task-surface={props.callId}>
      <header className={css.header}>
        <h3 className={css.title}>{model.title}</h3>
      </header>
      <TaskSurfacePanel model={model} t={t} submit={submit} idPrefix={`task-surface-${props.callId}`} readOnly />
    </article>
  )
}
