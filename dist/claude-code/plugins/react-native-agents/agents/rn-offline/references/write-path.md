# The Write Path

Where the severity is. A failed read shows stale data; a failed write can destroy something the
user made, or charge them twice.

## Persist before you send

```ts
// ✗ the only record of this action is in memory
async function addNote(text: string) {
  setNotes((n) => [...n, { id: tempId(), text }]);
  await api.post('/notes', { text });
}

// ✓ durable first
async function addNote(text: string) {
  const op = { id: uuid(), type: 'createNote', payload: { text }, createdAt: Date.now() };
  await queue.enqueue(op);        // written to storage
  applyOptimistic(op);
  void queue.flush();
}
```

If the app is killed between the tap and the response — a swipe-away, a crash, an OOM kill in the
background — the in-memory version is gone with no error. The user believes they saved a note. This
is the highest-severity offline bug and it is very common.

## Idempotency, or you will duplicate

A retry after an ambiguous failure is the dangerous case: the request may have succeeded and the
response been lost. Retrying then creates a second order, a second charge, a second message.

```ts
await fetch('/orders', {
  method: 'POST',
  headers: { 'Idempotency-Key': op.id },   // stable across every retry of this operation
  body: JSON.stringify(op.payload),
});
```

The key must be generated **once when the operation is created** and reused for every attempt.
Generating it per attempt defeats the purpose entirely.

This needs server cooperation. If the server does not support idempotency keys, that is a finding
worth raising rather than working around on the client — client-side deduplication cannot fix a
double charge.

## Backoff with jitter

```ts
const delay = Math.min(MAX_DELAY, BASE * 2 ** attempt);
const jittered = delay * (0.5 + Math.random() * 0.5);   // 50–100% of the delay
```

Exponential backoff stops one device hammering a server. **Jitter** stops every device retrying in
lockstep — without it, connectivity returning after an outage produces a synchronised thundering
herd, which can keep the server down.

Cap the attempts. An operation that has failed twenty times will not succeed on the twenty-first,
and the user should be told rather than having it retried forever.

## Not everything should be retried

| Response | Retry? |
|---|---|
| Network error, timeout | Yes |
| 5xx | Yes, with backoff |
| 429 | Yes, respecting `Retry-After` |
| 401 | Once, after refreshing the token |
| 400, 422 | **No** — it will fail identically forever |
| 403, 404 | No |

Retrying a 400 forever is a queue that never drains, blocking every operation behind it.

## Order matters, sometimes

Operations on the same entity usually need ordering — create then update then delete is not the
same in another order. Independent operations do not.

The simple, safe design is a FIFO queue that stops on a hard failure. The failure mode to watch is
**head-of-line blocking**: one permanently failing operation stalls everything behind it. Move a
dead operation to a failure list and let the rest proceed.

## Bound the queue

An unbounded queue on a device that has been offline for a week is a storage problem and a sync
problem. Cap its size, and decide explicitly what happens at the cap — reject new operations with a
clear message, or drop the oldest, but choose rather than discovering it.

## Auth and queued writes

A write queued at 9am and replayed at 3pm may carry an expired token. The flush must refresh
credentials and retry, not drop the operation. If the user has signed out in between, the queue
belongs to the previous session — replaying it into a new account is a serious bug, so scope the
queue to the account that created it.

## Tell the user

Every operation is `pending`, `syncing`, `failed`, or `synced`, and the UI should be able to show
it. Silent failure is the one outcome that is never acceptable — a user who is not told is a user
who finds out later that their work is gone.
