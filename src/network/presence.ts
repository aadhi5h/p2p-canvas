import type { DataChannelTransport } from "./data-channel-transport.js";

export interface PresenceState {
  peerId: string;
  online: boolean;
  cursorX?: number;
  cursorY?: number;
  vpX?: number;
  vpY?: number;
  vpZoom?: number;
}

type PresenceMessage = { kind: "presence"; state: PresenceState };
export type PresenceListener = (state: PresenceState) => void;

export class PresenceTracker {
  private peers = new Map<string, PresenceState>();
  private transportToPeerId = new Map<DataChannelTransport, string>();
  private listeners = new Set<PresenceListener>();
  private transports = new Set<DataChannelTransport>();
  private lastCursorSend = -Infinity;
  private lastViewportSend = -Infinity;

  constructor(private readonly localPeerId: string) {}

  attachTransport(transport: DataChannelTransport): void {
    this.transports.add(transport);
    transport.onMessage((raw) => this.handleMessage(transport, raw));
    this.send(transport, { peerId: this.localPeerId, online: true });
  }

  detachTransport(transport: DataChannelTransport): void {
    this.transports.delete(transport);
    const remotePeerId = this.transportToPeerId.get(transport);
    this.transportToPeerId.delete(transport);
    if (remotePeerId === undefined) return;
    this.peers.delete(remotePeerId);
    for (const l of this.listeners) l({ peerId: remotePeerId, online: false });
  }

  onPresenceChange(listener: PresenceListener): void {
    this.listeners.add(listener);
  }

  getOnlinePeers(): PresenceState[] {
    return Array.from(this.peers.values()).filter((p) => p.online);
  }

  broadcastCursor(x: number, y: number): void {
    const now = performance.now();
    if (now - this.lastCursorSend < 50) return;
    this.lastCursorSend = now;
    const state: PresenceState = { peerId: this.localPeerId, online: true, cursorX: x, cursorY: y };
    for (const transport of this.transports) this.send(transport, state);
  }

  broadcastViewport(vp: { x: number; y: number; zoom: number }): void {
    const now = performance.now();
    if (now - this.lastViewportSend < 100) return; // viewport changes less often than cursor, lower rate is fine
    this.lastViewportSend = now;
    const state: PresenceState = { peerId: this.localPeerId, online: true, vpX: vp.x, vpY: vp.y, vpZoom: vp.zoom };
    for (const transport of this.transports) this.send(transport, state);
  }

  private handleMessage(transport: DataChannelTransport, raw: string): void {
    let message: PresenceMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.kind !== "presence") return;
    this.transportToPeerId.set(transport, message.state.peerId);
    // Merge rather than replace — a cursor-only or viewport-only
    // message shouldn't erase whichever fields the other message type
    // last set (they're broadcast on separate throttled schedules).
    const existing = this.peers.get(message.state.peerId) ?? { peerId: message.state.peerId, online: true };
    this.peers.set(message.state.peerId, { ...existing, ...message.state });
    for (const l of this.listeners) l(this.peers.get(message.state.peerId)!);
  }

  private send(transport: DataChannelTransport, state: PresenceState): void {
    transport.send(JSON.stringify({ kind: "presence", state } satisfies PresenceMessage));
  }
}
