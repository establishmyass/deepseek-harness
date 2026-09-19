// @vitest-environment jsdom
/** The shared panel body: submission formatting and the form lifecycle. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { formatSubmission, parseSurfaceModel, parseSurfaceModelValue } from '../src/client/model.ts'
import { TaskSurfacePanel, type TaskSurfacePanelProps } from '../src/client/TaskSurfacePanel.tsx'
import { zh } from '../src/client/locales.ts'

const t = makeTranslate(zh)

afterEach(cleanup)

const MODEL = {
  version: 1,
  title: 'Ship the panel',
  sections: [{
    id: 'section',
    title: 'S',
    blocks: [{ kind: 'markdown', text: 'plain' }],
  }],
  fields: [
    { kind: 'text', id: 'note', label: 'Note', multiline: true, required: true, initial: 'none' },
    { kind: 'text', id: 'branch', label: 'Branch' },
    { kind: 'choice', id: 'strategy', label: 'Strategy', options: [{ id: 'canary', label: 'Canary' }, { id: 'all', label: 'All at once' }], initial: 'canary' },
    { kind: 'multi-choice', id: 'checks', label: 'Checks', options: [{ id: 'smoke', label: 'Smoke' }, { id: 'load', label: 'Load' }] },
    { kind: 'toggle', id: 'notify', label: 'Notify', initial: true },
  ],
  submit: { label: 'Approve' },
}

/** One panel's props with a recording submission writer. */
function panelProps(
  model: unknown,
  submit: (text: string) => Promise<void> = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve()),
): TaskSurfacePanelProps {
  const parsed = parseSurfaceModelValue(model)
  if (parsed === null) throw new Error('expected a parsed model')
  return { model: parsed, t, submit, idPrefix: 'task-surface-test' }
}

describe('formatSubmission', () => {
  it('renders one labeled line per answered field in declaration order', () => {
    const model = parseSurfaceModel(JSON.stringify({ model: MODEL }))
    if (model === null) throw new Error('expected a parsed model')
    expect(formatSubmission(model, {
      note: '  ship it  ',
      strategy: 'all',
      checks: ['smoke', 'load', 'vanished'],
      notify: false,
    }, t)).toBe([
      'Task Surface「Ship the panel」的答复',
      '- Note: ship it',
      '- Strategy: All at once',
      '- Checks: Smoke, Load, vanished',
      '- Notify: 否',
    ].join('\n'))
  })

  it('omits unanswered fields, keeps the toggle state, and falls back to the raw id for an unknown choice', () => {
    const model = parseSurfaceModel(JSON.stringify({ model: MODEL }))
    if (model === null) throw new Error('expected a parsed model')
    expect(formatSubmission(model, { strategy: 'mystery' }, t)).toBe([
      'Task Surface「Ship the panel」的答复',
      '- Strategy: mystery',
      '- Notify: 否',
    ].join('\n'))
  })
})

describe('TaskSurfacePanel', () => {
  it('holds submit closed while a required field is empty, then sends the formatted message', async () => {
    const sent: string[] = []
    const submit = vi.fn<(text: string) => Promise<void>>((text) => {
      sent.push(text)
      return Promise.resolve()
    })
    render(<TaskSurfacePanel {...panelProps(MODEL, submit)} />)
    const button = screen.getByRole('button', { name: 'Approve' })
    fireEvent.change(screen.getByLabelText(/Note/u), { target: { value: '   ' } })
    expect(button).toHaveProperty('disabled', true)
    fireEvent.change(screen.getByLabelText(/Note/u), { target: { value: 'ship it' } })
    expect(button).toHaveProperty('disabled', false)
    fireEvent.click(button)
    expect(sent).toEqual([[
      'Task Surface「Ship the panel」的答复',
      '- Note: ship it',
      '- Strategy: Canary',
      '- Notify: 是',
    ].join('\n')])
    expect(await screen.findByText('已发送；模型会收到这份答复。')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', true)
  })

  it('collects choices, multi-choices, and toggles from the panel controls', () => {
    const sent: string[] = []
    const submit = vi.fn<(text: string) => Promise<void>>((text) => {
      sent.push(text)
      return Promise.resolve()
    })
    render(<TaskSurfacePanel {...panelProps(MODEL, submit)} />)
    fireEvent.click(screen.getByLabelText('All at once'))
    fireEvent.click(screen.getByLabelText('Smoke'))
    fireEvent.click(screen.getByLabelText('Load'))
    // A second click on a checked box takes the option back out.
    fireEvent.click(screen.getByLabelText('Load'))
    fireEvent.click(screen.getByLabelText('Smoke'))
    fireEvent.click(screen.getByLabelText('Smoke'))
    fireEvent.click(screen.getByLabelText('Notify'))
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'release/1.2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(sent).toEqual([[
      'Task Surface「Ship the panel」的答复',
      '- Note: none',
      '- Branch: release/1.2',
      '- Strategy: All at once',
      '- Checks: Smoke',
      '- Notify: 否',
    ].join('\n')])
  })

  it('keeps the values editable and shows the reason when admission fails', async () => {
    const submit = vi.fn<(text: string) => Promise<void>>(() => Promise.reject(new Error('the host is offline')))
    render(<TaskSurfacePanel {...panelProps(MODEL, submit)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '发送失败：the host is offline')
    expect(screen.getByRole('button', { name: 'Approve' })).toHaveProperty('disabled', false)
    expect(screen.getByLabelText(/Note/u)).toHaveProperty('value', 'none')
  })

  it('reports a rejection that is not an Error as its own text', async () => {
    // A non-Error rejection is exactly the fallback branch under test.
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors
    const submit = vi.fn<(text: string) => Promise<void>>(() => Promise.reject('boom'))
    render(<TaskSurfacePanel {...panelProps(MODEL, submit)} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '发送失败：boom')
  })

  it('ignores a submit that arrives while a required field is still empty', () => {
    const submit = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve())
    render(<TaskSurfacePanel {...panelProps(MODEL, submit)} />)
    const button = screen.getByRole('button', { name: 'Approve' })
    const form = button.closest('form')
    if (form === null) throw new Error('expected the panel form')
    fireEvent.change(screen.getByLabelText(/Note/u), { target: { value: '' } })
    fireEvent.submit(form)
    expect(submit).not.toHaveBeenCalled()
  })

  it('renders a panel with no fields at all as content only', () => {
    const bare = { version: 1, title: 'T', description: 'D', sections: [], submit: { label: 'OK' } }
    const bareModel = parseSurfaceModelValue(bare)
    if (bareModel === null) throw new Error('expected a parsed model')
    expect(formatSubmission(bareModel, {}, t)).toBe('Task Surface「T」的答复')
    const { container } = render(<TaskSurfacePanel {...panelProps(bare)} />)
    expect(container.querySelector('form')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    // An explicit empty field list renders content only as well.
    render(<TaskSurfacePanel {...panelProps({ ...bare, fields: [] })} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders a stack section and ignores field initials that contradict their arm', () => {
    const malformed = {
      version: 1,
      title: 'T',
      sections: [{ id: 's', title: 'S', blocks: [{ kind: 'markdown', text: 'plain' }] }],
      fields: [
        { kind: 'text', id: 't', label: 'T', initial: 7 },
        { kind: 'choice', id: 'c', label: 'C', options: [{ id: 'a', label: 'A' }], initial: 7 },
        { kind: 'multi-choice', id: 'm', label: 'M', options: [{ id: 'a', label: 'A' }], initial: 'a' },
        { kind: 'multi-choice', id: 'm2', label: 'M2', options: [{ id: 'a', label: 'A' }], initial: ['a'] },
        { kind: 'toggle', id: 'g', label: 'G' },
      ],
      submit: { label: 'OK' },
    }
    const sent: string[] = []
    const submit = vi.fn<(text: string) => Promise<void>>((text) => {
      sent.push(text)
      return Promise.resolve()
    })
    const { container } = render(<TaskSurfacePanel {...panelProps(malformed, submit)} />)
    expect(screen.getByText('S')).toBeTruthy()
    expect(container.querySelector('[data-columns]')).toBeNull()
    expect(screen.getByLabelText('T')).toHaveProperty('value', '')
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    expect(sent).toEqual(['Task Surface「T」的答复\n- M2: A\n- G: 否'])
  })

  it('keeps the actions row out of a read-only replay', () => {
    render(<TaskSurfacePanel {...panelProps(MODEL)} readOnly actions={<button type="button">Extra</button>} />)
    expect(screen.getByRole('button', { name: 'Extra' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
  })
})
