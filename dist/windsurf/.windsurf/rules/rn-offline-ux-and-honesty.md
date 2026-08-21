---
trigger: manual
description: "RN Offline: Telling the User the Truth"
---

# Telling the User the Truth

The technical side of offline is a queue and a retry policy. The part users judge you on is whether
the app told them the truth about their data.

## Optimistic updates need rollback

```tsx
// ✗ the UI now shows something that did not happen
setItems((prev) => [...prev, newItem]);
api.post('/items', newItem);           // if this fails, nobody finds out

// ✓
const previous = items;
setItems((prev) => [...prev, { ...newItem, status: 'pending' }]);
try {
  const saved = await api.post('/items', newItem);
  setItems((prev) => prev.map((i) => (i.id === newItem.id ? saved : i)));
} catch (e) {
  setItems(previous);
  showRetry('Could not save. Tap to try again.');
}
```

An optimistic update without rollback is a lie the app tells at the exact moment the user most needs
accuracy. Rolling back silently is nearly as bad — the item vanishes and they wonder whether they
imagined adding it.

## Optimism should match confidence

Optimistic UI suits actions that almost always succeed and are cheap to reverse: a like, a
reordering, a note. It suits payments and bookings badly. Showing "Order placed" for something that
may not have been placed is worse than a spinner.

The test: if this turns out to have failed, how bad is the moment when the user finds out? For a
like, trivial. For a booking, severe.

## Name the state per item

A global "syncing" indicator does not tell someone whether **their** note saved. Per-item state
does.

```tsx
{item.status === 'pending' && <Icon name="clock" accessibilityLabel="Waiting to sync" />}
{item.status === 'failed'  && <Retry onPress={() => retry(item)} />}
```

Include the accessibility label — an icon-only status is invisible to a screen reader user, who then
has no way to know their content did not save. Hand that to `rn-ui-accessibility`.

## Do not block on connectivity

Disabling the compose button while offline prevents the user from writing something they could have
queued. Let them act; queue it; tell them it is queued. Reserve blocking for things that genuinely
cannot work offline, and say why.

## Failure must be visible and actionable

Three requirements, in order of importance:

1. **The user is told.** Silence is the unacceptable outcome.
2. **Their content is not lost.** They can retry without retyping.
3. **There is an action** — retry, discard, or edit.

A toast that disappears after three seconds satisfies none of these. Persistent state on the item
satisfies all three.

## Say what you can substantiate

"You're offline" may be false — the connection may be fine and the API down. "Couldn't save your
note — we'll retry automatically" describes what you actually observed and what you will do about
it.

The second is more useful and it is also more honest, which matters because a user who catches the
app being wrong about the network stops trusting everything else it says.
