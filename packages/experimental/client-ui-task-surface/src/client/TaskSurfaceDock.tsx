/**
 * The input dock: the only editor for an open Task Surface.
 *
 * It reads the Host's `taskSurface` projection instead of the transcript, so a
 * refresh, a reconnect, and a session switch all recover the same panel even
 * when the opening call has scrolled out of the loaded history. Dismissal goes
 * through the Host command, whose log event closes the projection — the dock
 * holds no state the log does not.
 *
 * @module @deepseek-ai/dsh-experimental-client-ui-task-surface/client
 */

import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseSurfaceModelValue } from './model.ts'
import type { TaskSurfaceInjected } from './TaskSurfaceCard.tsx'
import { TaskSurfacePanel } from './TaskSurfacePanel.tsx'
import css from './TaskSurfaceCard.module.css'

/**
 * Client mirror of the Host unit's published view. `packages/experimental/tool-task-surface`
 * owns the value and its wire schema; this shape only names what the dock reads,
 * and the read below is the one place the dock names the key.
 */
interface TaskSurfaceProjectionView {
  readonly active: { readonly callId: string; readonly surfaceId: string; readonly model: unknown } | null
}

/** Verbs the dock's injected face adds to the submission writer. */
export interface TaskSurfaceDockInjected extends TaskSurfaceInjected {
  /** Append one durable dismissal for an exact surface id. */
  readonly dismiss: (surfaceId: string) => Promise<void>
}

/** Full props of the `conversation.input.dock` entry. */
export type TaskSurfaceDockProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'taskSurface'>
  & TaskSurfaceDockInjected

/**
 * Render the open panel above the composer, or nothing while none is open.
 * @param props - dock standard props plus the submission and dismissal verbs.
 * @returns the dock, or `null`.
 */
export function TaskSurfaceDock(props: TaskSurfaceDockProps): ReactNode {
  const { t, useProjection, submit, dismiss } = props
  const [failure, setFailure] = useState<string | null>(null)
  // The key is this package's contract with the Host unit. The client's own
  // program does not include that unit's map merge, so the read names its
  // result type here; the aggregate program knows the key and needs no cast.
  /* oxlint-disable-next-line typescript/no-unnecessary-type-assertion */
  const view = (useProjection as (key: string) => TaskSurfaceProjectionView | undefined)('taskSurface')
  const active = view?.active
  const model = active === undefined || active === null ? null : parseSurfaceModelValue(active.model)

  if (active === undefined || active === null || model === null) return null
  const onDismiss = (): void => {
    setFailure(null)
    void dismiss(active.surfaceId).then(() => undefined, (error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error))
    })
  }

  return (
    <section className={css.dock} data-task-surface={active.surfaceId} aria-label={t('dock.label', { title: model.title })}>
      <header className={css.dockHeader}>
        <span className={css.dockLabel}>{t('dock.label', { title: model.title })}</span>
        <button className={css.dockAction} type="button" onClick={onDismiss}>{t('dock.dismiss')}</button>
      </header>
      <TaskSurfacePanel
        model={model}
        t={t}
        submit={submit}
        idPrefix={`task-surface-dock-${active.surfaceId}`}
      />
      {failure !== null && <p className={css.failure} role="alert">{t('state.failed', { message: failure })}</p>}
    </section>
  )
}
