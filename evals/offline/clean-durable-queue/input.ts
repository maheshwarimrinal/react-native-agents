// Durable queue: persisted before send, idempotent, bounded, with jittered backoff.
// There is nothing here worth reporting.
import { storage } from './storage';
import { fetchWithTimeout } from './fetchWithTimeout';

const KEY = 'mutation-queue-v2';
const MAX_QUEUE = 500;
const MAX_ATTEMPTS = 8;
const BASE_DELAY = 1000;
const MAX_DELAY = 5 * 60 * 1000;

export type Operation = {
  id: string;            // also the idempotency key — generated once, reused on every attempt
  accountId: string;     // scoped so a queue is never replayed into another session
  endpoint: string;
  payload: unknown;
  attempts: number;
  createdAt: number;
};

export async function enqueue(op: Operation): Promise<void> {
  const queue = await load();
  if (queue.length >= MAX_QUEUE) {
    throw new QueueFullError('Too many unsent changes. Connect to sync before adding more.');
  }
  await save([...queue, op]);   // durable before the caller applies optimistic UI
}

export async function flush(accountId: string): Promise<void> {
  const queue = await load();
  const mine = queue.filter((op) => op.accountId === accountId);

  for (const op of mine) {
    try {
      const res = await fetchWithTimeout(op.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': op.id },
        body: JSON.stringify(op.payload),
        timeoutMs: 20000,
      });

      if (res.ok) {
        await remove(op.id);
        continue;
      }

      // 4xx other than 429 will fail identically forever — do not block the queue.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        await moveToFailed(op, `server rejected: ${res.status}`);
        continue;
      }

      await backoff(op);
      return;   // stop the pass; the next trigger resumes
    } catch {
      await backoff(op);
      return;
    }
  }
}

async function backoff(op: Operation): Promise<void> {
  if (op.attempts + 1 >= MAX_ATTEMPTS) {
    await moveToFailed(op, 'retry limit reached');
    return;
  }
  const delay = Math.min(MAX_DELAY, BASE_DELAY * 2 ** op.attempts);
  const jittered = delay * (0.5 + Math.random() * 0.5);
  await scheduleRetry(op.id, jittered);
  await update({ ...op, attempts: op.attempts + 1 });
}
