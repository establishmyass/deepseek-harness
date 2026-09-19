/** Task Surface Web dictionaries. */

/** Locale namespace owned by the Task Surface Web panel. */
export const NS = 'taskSurface'

/** Simplified Chinese dictionary and key source. */
export const zh = {
  'submission.header': 'Task Surface「{title}」的答复',
  'value.yes': '是',
  'value.no': '否',
  'state.sending': '正在发送…',
  'state.sent': '已发送；模型会收到这份答复。',
  'state.failed': '发送失败：{message}',
  'state.pending': '这个面板还没生成完。',
  'copy': '复制',
  'copied': '已复制',
  'footnotes': '脚注',
}

/** English dictionary, keyed by the Chinese source. */
export const en: typeof zh = {
  'submission.header': 'Task Surface "{title}" answers',
  'value.yes': 'yes',
  'value.no': 'no',
  'state.sending': 'Sending…',
  'state.sent': 'Sent; the model receives these answers.',
  'state.failed': 'Sending failed: {message}',
  'state.pending': 'This panel has not finished streaming.',
  'copy': 'Copy',
  'copied': 'Copied',
  'footnotes': 'Footnotes',
}

/** Every key this package may translate. */
export type TaskSurfaceKey = keyof typeof zh
