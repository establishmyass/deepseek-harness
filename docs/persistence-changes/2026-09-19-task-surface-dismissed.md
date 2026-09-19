---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-19-task-surface-dismissed

English | [中文](2026-09-19-task-surface-dismissed.zh.md)

## Summary

Adds the `task-surface/dismissed` Session event, recording one dismissed Task Surface by its surface id.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-19-task-surface-dismissed
baseline: false
changes:
  - root: "event:task-surface/dismissed"
    previous: null
    after: "a0e58dcc64d99e0fb31edd47206f30276da846470106991d758a0cbde466c468"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid. The event carries `ignorable: true`, so a build that does not know the type reads the log without it. Readers fold it only to close an open `taskSurface` panel; no other consumer exists, and the panel state is recoverable from the log when the event is absent.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/experimental/tool-task-surface/tests/tool-task-surface.spec.ts: 11 tests passed, including 'closes on a matching dismissal or the user own next message' and 'dismisses one exact surface through the command, and rejects anything else'.

<a id="dev-note"></a>
## Dev Note

None.
