# CRDT Merge Behavior

## Current Model: Whole-Value Last-Writer-Wins (LWW)

Every shape is stored as a single atomic entry, keyed by shape ID and tagged with a Lamport timestamp (`{ counter, peerId }`).

When two peers independently edit the **same shape**, whichever edit has the higher timestamp replaces the **entire shape object**-not just the fields that changed.

When two timestamps have the same `counter`, the higher `peerId` (lexical string comparison) wins. This tie-breaking rule is arbitrary but deterministic, ensuring that every peer reaches the same result.

## What This Means in Practice

If Peer A changes a shape's `color` while Peer B concurrently moves the same shape's `x`/`y`, **one of those two edits is silently and completely discarded**.

The edits are not merged or partially applied. There is no error, warning, or conflict marker. The losing edit simply disappears as if it never happened.

This behavior has been proven in two ways:

* **Automated tests:** `src/crdt/concurrent-field-edit.test.ts` and `src/crdt/conflicting-positions.test.ts`
* **Live testing:** Real two-peer WebRTC testing using the "FORCE Collision" buttons in `main.ts`. These deliberately bypass the merge-with-current-state behavior of `updateShape()` so that network timing cannot accidentally resolve the race.

## Why This Is the Current Design

Whole-value LWW is the simplest CRDT model that provides a **correct convergence guarantee**.

Given the same set of operations, regardless of the order in which peers receive them, every peer deterministically arrives at the same final state.

This convergence guarantee has been verified by the existing test suite. Field-level merging is significantly more complex to reason about and implement correctly, so it was deliberately deferred.

## Known Limitation

Concurrent edits to **different fields of the same shape** can result in data loss.

For example:

* Peer A changes `color` → `red`
* Peer B changes `x` → `500`
* One complete shape version wins
* The other change is lost

The planned deterministic object merge policy is intended to move the implementation from whole-value LWW toward **field-level or operation-level merging**.

With that approach, concurrent changes to different fields-such as a color change and a position change-can both survive.

## Practical Guidance

* **Different shapes:** Edits never conflict and can be performed concurrently.
* **Same shape, same field:** Exactly one edit wins deterministically across all peers.
* **Same shape, different fields:** Concurrent edits can currently cause data loss. Do not rely on these edits being merged correctly until field-level merging is implemented.
