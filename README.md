# P2P Canvas

A serverless, real-time collaborative canvas built from scratch — peer-to-peer over WebRTC, with no backend and no central source of truth. Think a minimal, ephemeral Figma: draw, move, and edit shapes together with anyone you connect to directly.

## Features

- **Conflict-free collaborative editing** — a custom per-field Last-Writer-Wins CRDT resolves concurrent edits deterministically across all peers, with no server arbitrating state.
- **Peer-to-peer networking** — direct WebRTC data channels between browsers; no signaling server (manual offer/answer exchange), no relay, no central point of failure.
- **End-to-end encryption** — every synced op and presence update is encrypted in-browser via ECDH key exchange (P-256) and AES-GCM, with built-in tamper detection on every message.
- **WebGPU rendering pipeline** — a GPU-accelerated renderer with viewport culling and GPU-based color-picking hit testing, running alongside the primary Canvas2D renderer.
- **Live presence** — real-time cursor positions and viewport (pan/zoom) indicators for every connected peer.
- **Drawing tools** — shape creation (rectangles, circles), freehand pen drawing, an eraser, a color picker, and a fill tool.
- **Proven correctness under load** — a full CRDT test suite covering concurrent creation, concurrent field edits, deletion races, offline/reconnect merging, and a stress test validating convergence across 25 peers and 5,000+ operations.

## Architecture

```
  Browser Tab A                               Browser Tab B
┌──────────────────┐                     ┌──────────────────┐
│  CrdtProvider    │ ◄──WebRTC (E2EE)──► │  CrdtProvider    │
│  (LWW per-field  │   Data Channel      │  (LWW per-field) │
├──────────────────┤                     ├──────────────────┤
│  CanvasState     │                     │  CanvasState     │
│  (render mirror) │                     │  (render mirror  │
├──────────────────┤                     ├──────────────────┤
│ Canvas2D / WebGPU│                     │ Canvas2D / WebGPU│
└──────────────────┘                   	 └──────────────────┘
```

- **`CrdtDocument`** — the core conflict-free data structure. Every shape property is tracked independently with its own Lamport timestamp, so concurrent edits to different fields of the same shape both survive instead of one overwriting the other.
- **`CrdtProvider`** — wraps the document with network lifecycle: broadcasting local ops (batched via microtask), applying remote ops, and snapshot-syncing newly connected peers.
- **`CanvasState`** — a passive, render-facing mirror of whatever the CRDT currently resolves to. Rendering code never touches the CRDT directly.
- **`PeerManager`** — manages one or more independent `RTCPeerConnection`s via manual offer/answer signaling, enabling a hub-and-spoke topology.
- **`EncryptedTransport`** — wraps each data channel with an ECDH handshake and AES-GCM encryption before any application data crosses the wire.
- **`PresenceTracker`** — a separate, ephemeral (non-CRDT) system for cursor and viewport broadcast, since presence data needs no conflict resolution or persistence.

## Tech stack

- TypeScript, compiled with `tsc` (no bundler)
- WebRTC (`RTCPeerConnection`, `RTCDataChannel`)
- WebGPU (device/context, custom WGSL shaders)
- Web Crypto API (ECDH, AES-GCM)
- Canvas2D (primary renderer)

## Getting started

```bash
npm install
npm run build
npm run serve
```

Open two browser tabs at `http://localhost:8080`. Connect them via the **Invite** panel:

1. **Tab A** — click *Create offer*, copy the generated blob.
2. **Tab B** — paste it into the offer box, click *Join with offer*, copy the resulting answer.
3. **Tab A** — paste the answer back, click *Complete connection*.

Both tabs should show as connected, and edits made in either tab sync live to the other, encrypted end to end.

## Tools

| Tool | Action |
|---|---|
| **Select** (default) | Click empty canvas to create a random shape in the current color; drag existing shapes to move them. |
| **Pen** | Click-drag to draw a freehand stroke in the current color. |
| **Eraser** | Click or drag over any shape (including strokes) to delete it. |
| **Fill** | Floods the current viewport with the selected color, placed behind existing shapes. |
| **Color picker** | Sets the color used by new shapes, pen strokes, and fill. |

## Testing

```bash
npm test
```

Runs the full test suite — CRDT convergence (concurrent creation, field-level conflicts, deletion races), presence merging, offline/reconnect behavior, and a multi-peer stress test.

## Known limitations

- **Manual signaling only** — no signaling server, so connecting requires manually exchanging offer/answer blobs between tabs. Not suitable for non-technical users as-is.
- **Hub-and-spoke topology, not full mesh** — peers only see each other if connected through a shared hub; if the hub disconnects, indirectly-connected peers lose contact with each other.
- **STUN only, no TURN** — connections may fail across strict NATs or corporate firewalls.
- **No persistence** — state lives only in memory; refreshing a tab with no connected peers loses all local edits.
- **No encryption identity verification** — the ECDH handshake secures the channel against eavesdropping and tampering, but does not authenticate *who* you're connecting to.

See [`docs/MERGE_BEHAVIOR.md`](docs/MERGE_BEHAVIOR.md) for a detailed explanation of the CRDT's conflict-resolution semantics.

## Status

`v1` — feature-complete for its original scope as a from-scratch learning project in CRDTs, WebRTC, WebGPU, and applied cryptography.