// @vitest-environment jsdom
/** The input dock: the projection read, the submission, and the dismissal. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { TaskSurfaceDock, type TaskSurfaceDockProps } from '../src/client/TaskSurfaceDock.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

const MODEL = {
  version: 1,
  title: 'Ship the panel',
  sections: [{ id: 'section', blocks: [{ kind: 'notice', tone: 'info', text: 'Pick one.' }] }],
  fields: [
    { kind: 'text', id: 'note', label: 'Note', initial: 'none' },
    { kind: 'choice', id: 'strategy', label: 'Strategy', options: [{ id: 'canary', label: 'Canary' }], initial: 'canary' },
  ],
  submit: { label: 'Approve' },
}

/** Dock props over one projection value. */
function dockProps(
  value: unknown,
  overrides: Partial<TaskSurfaceDockProps> = {},
): TaskSurfaceDockProps {
  return {
    session: {},
    input: {},
    sessionId: 's1',
    t,
    useProjection: () => value,
    useSession: () => undefined,
    submit: vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
    dismiss: vi.fn<(surfaceId: string) => Promise<void>>(() => Promise.resolve()),
    ...overrides,
  } as unknown as TaskSurfaceDockProps
}

/** One published, active panel. */
const ACTIVE = { active: { callId: 'c1', surfaceId: 'abcdef0123456789', model: MODEL } }

describe('TaskSurfaceDock', () => {
  it('renders nothing while the projection holds no open panel', () => {
    const empty = render(<TaskSurfaceDock {...dockProps(null)} />)
    expect(empty.container.innerHTML).toBe('')
    const idle = render(<TaskSurfaceDock {...dockProps({ active: null })} />)
    expect(idle.container.innerHTML).toBe('')
  })

  it('renders nothing for a published model this renderer cannot own', () => {
    const { container } = render(
      <TaskSurfaceDock {...dockProps({ active: { callId: 'c1', surfaceId: 'x', model: { version: 9 } } })} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('is the editor: it renders the open panel and admits one submission', async () => {
    const sent: string[] = []
    const submit = vi.fn<(text: string) => Promise<void>>((text) => {
      sent.push(text)
      return Promise.resolve()
    })
    const { container } = render(<TaskSurfaceDock {...dockProps(ACTIVE, { submit })} />)
    expect(container.querySelector('[data-task-surface="abcdef0123456789"]')).toBeTruthy()
    expect(screen.getByText(/Task Surface「Ship the panel」/u)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'ship it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(sent).toEqual([
      'Task Surface「Ship the panel」的答复\n- Note: ship it\n- Strategy: Canary',
    ])
    expect(await screen.findByText('已发送；模型会收到这份答复。')).toBeTruthy()
  })

  it('dismisses one exact surface', async () => {
    const dismiss = vi.fn<(surfaceId: string) => Promise<void>>(() => Promise.resolve())
    render(<TaskSurfaceDock {...dockProps(ACTIVE, { dismiss })} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    expect(dismiss).toHaveBeenCalledWith('abcdef0123456789')
  })

  it('reports a dismissal the host refused', async () => {
    const failing = vi.fn<(surfaceId: string) => Promise<void>>(
      () => Promise.reject(new Error('the host is offline')),
    )
    render(<TaskSurfaceDock {...dockProps(ACTIVE, { dismiss: failing })} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '发送失败：the host is offline')
  })

  it('reports a rejection that is not an Error as its own text', async () => {
    // A non-Error rejection is exactly the fallback branch under test.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    const bare = vi.fn<(surfaceId: string) => Promise<void>>(() => Promise.reject('gone'))
    render(<TaskSurfaceDock {...dockProps(ACTIVE, { dismiss: bare })} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭面板' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '发送失败：gone')
  })
})
