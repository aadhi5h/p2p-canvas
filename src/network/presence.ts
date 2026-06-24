import type { DataChannelTransport } from "./data-channel-transport.js";

export interface PresenceState {
  peerId: string;
  online: boolean;
}

type PresenceMessage = { kind: "presence"; state: PresenceState };

export type PresenceListener = (state: PresenceState) => void;

/**
 * Tracks "who's currently here" — deliberately NOT part of CrdtProvider.
 * No timestamps, no conflict resolution, no snapshot replay.
 *
 * IMPORTANT: the "peerId" a remote peer announces (their own self-
 * identity, e.g. used for CrdtDocument) is a DIFFERENT namespace than
 * PeerManager's per-connection id (a random id generated fresh for
 * each handshake, local bookkeeping only). This class must not
 * assume the caller knows which remote identity belongs to which
 * transport — it learns that itself from the first presence message
 * received on that transport, and uses ITS OWN mapping for cleanup.
 */
export class PresenceTracker {
  private peers = new Map<string, PresenceState>();
  private transportToPeerId = new Map<DataChannelTransport, string>();
  private listeners = new Set<PresenceListener>();
  private transports = new Set<DataChannelTransport>();

  constructor(private readonly localPeerId: string) {}

  attachTransport(transport: DataChannelTransport): void {
    this.transports.add(transport);
    transport.onMessage((raw) => this.handleMessage(transport, raw));
    this.send(transport, { peerId: this.localPeerId, online: true });
  }

  /** No id parameter needed — we already know which identity this transport belongs to. */
  detachTransport(transport: DataChannelTransport): void {
    this.transports.delete(transport);
    const remotePeerId = this.transportToPeerId.get(transport);
    this.transportToPeerId.delete(transport);
    if (remotePeerId === undefined) return; // never received a presence message from them — nothing to clean up
    this.peers.delete(remotePeerId);
    for (const l of this.listeners) l({ peerId: remotePeerId, online: false });
  }

  onPresenceChange(listener: PresenceListener): void {
    this.listeners.add(listener);
  }

  getOnlinePeers(): PresenceState[] {
    return Array.from(this.peers.values()).filter((p) => p.online);
  }

  private handleMessage(transport: DataChannelTransport, raw: string): void {
    let message: PresenceMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.kind !== "presence") return;
    this.transportToPeerId.set(transport, message.state.peerId); // learn the mapping
    this.peers.set(message.state.peerId, message.state);
    for (const l of this.listeners) l(message.state);
  }

  private send(transport: DataChannelTransport, state: PresenceState): void {
    transport.send(JSON.stringify({ kind: "presence", state } satisfies PresenceMessage));
  }
}
