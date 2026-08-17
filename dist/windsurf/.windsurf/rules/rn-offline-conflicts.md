---
trigger: manual
description: "RN Offline: Conflicts"
---

# Conflicts

Two devices, or one device and a colleague, changed the same thing while you were offline. Someone's
edit is about to disappear.

## Choose a strategy, do not inherit one

Most apps use last-write-wins by accident: the last request to arrive overwrites, and nobody decided
that. It is a legitimate strategy for some data and a data-loss bug for other data — the difference
is whether it was chosen.

| Strategy | Fits | Cost |
|---|---|---|
| **Last-write-wins** | Settings, single-user preferences | Silently discards the other edit |
| **First-write-wins** | Claims, bookings, anything won by being first | Later work is rejected |
| **Merge by field** | Records where fields are independent | Needs field-level tracking |
| **Append-only** | Messages, events, logs | Not applicable to mutable records |
| **Ask the user** | High-value, irreplaceable content | Interrupts, needs real UI |
| **CRDT** | Collaborative editing | Substantial complexity |

Write the choice down next to the model it applies to. The failure is not picking last-write-wins;
it is not knowing you did.

## Detect the conflict at all

You cannot resolve what you do not detect. Detection needs a version marker the server checks:

```ts
await fetch(`/notes/${id}`, {
  method: 'PUT',
  headers: { 'If-Match': note.etag },     // or send a version field
  body: JSON.stringify(payload),
});
// 412 Precondition Failed → someone else changed it since you last read it
```

Without this the server cannot tell a normal update from an overwrite of someone else's work, and
the client cannot know a conflict occurred. **A `updatedAt` timestamp compared on the client is not
sufficient** — clock skew between devices makes it unreliable in exactly the situations that matter.

## Field-level merging

If two users edit different fields of the same record, both edits can survive:

```ts
// Send only what this device actually changed
const patch = diff(original, current);
await api.patch(`/profile`, patch);
```

Sending the whole object means whatever you loaded overwrites everything, including fields you never
touched. This is a quiet and common form of data loss, and switching to patches removes a whole
class of conflict rather than resolving it.

## When you ask the user, give them something to act on

An "a conflict occurred" dialog with Keep Mine and Keep Theirs, showing neither version, is worse
than picking one silently. If you interrupt, show both and let them choose meaningfully — otherwise
resolve it yourself and tell them what you did.

## Deletion conflicts

The awkward case: edited on one device, deleted on another. The options are resurrect, discard, or
ask, and all three are defensible. What matters is that the code has an answer — the usual outcome
is a 404 on sync, an unhandled error, and an operation stuck in the queue forever.

## Test it deliberately

Conflicts do not occur in normal development because there is one device on fast wifi.

1. Two devices, or one device and an API client.
2. Take one offline.
3. Edit the same record on both.
4. Reconnect.
5. Observe what actually happened — not what you expected.

Step 5 is the one that surprises teams.
