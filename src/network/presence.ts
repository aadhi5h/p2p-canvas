import type { DataChannelTransport } from "./data-channel-transport.js";

export interface PresenceState {
  peerId: string;
  online: boolean;
  cursorX?: number;
  cursorY?: number;
}

type PresenceMessage = { kind: "presence"; state: PresenceState };

export type PresenceListener = (state: PresenceState) => void;

export class PresenceTracker {
  private peers = new Map<string, PresenceState>();
  private transportToPeerId = new Map<DataChannelTransport, string>();
  private listeners = new Set<PresenceListener>();
  private transports = new Set<DataChannelTransport>();
  private lastCursorSend = 0;

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

  /**
   * Broadcasts cursor position to every attached peer, throttled to
   * ~20/sec. Cursor movement fires constantly (every mousemove), and
   * without throttling we'd flood the data channel — presence data
   * is inherently "latest wins" so dropping intermediate positions
   * is completely fine, unlike CRDT ops where every op matters.
   */
  broadcastCursor(x: number, y: number): void {
    const now = performance.now();
    if (now - this.lastCursorSend < 50) return; // ~20Hz cap
    this.lastCursorSend = now;
    const state: PresenceState = { peerId: this.localPeerId, online: true, cursorX: x, cursorY: y };
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
    this.peers.set(message.state.peerId, message.state);
    for (const l of this.listeners) l(message.state);
  }

  private send(transport: DataChannelTransport, state: PresenceState): void {
    transport.send(JSON.stringify({ kind: "presence", state } satisfies PresenceMessage));
  }
}
