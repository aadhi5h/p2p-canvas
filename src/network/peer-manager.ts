import { PeerConnection } from "./peer-connection.js";
import { DataChannelTransport } from "./data-channel-transport.js";
import { waitForIceGatheringComplete, encodeSignal, decodeSignal } from "./manual-signaling.js";

export interface ManagedPeer {
  id: string;
  connection: PeerConnection;
  transport?: DataChannelTransport;
}

export type PeerStatusListener = (peerId: string, state: RTCPeerConnectionState) => void;
export type PeerTransportListener = (peerId: string, transport: DataChannelTransport) => void;
export type PeerDisconnectListener = (peerId: string, transport: DataChannelTransport | undefined) => void;

/**
 * Owns a growing set of independent peer connections, so the app
 * can broadcast to N peers instead of exactly one. Each peer gets
 * its own PeerConnection + DataChannelTransport, keyed by a random
 * local id (not a real peer identity — just enough to track "which
 * connection is this" across UI actions).
 */
export class PeerManager {
  private peers = new Map<string, ManagedPeer>();
  private statusListeners = new Set<PeerStatusListener>();
  private disconnectListeners = new Set<PeerDisconnectListener>();
  private transportListeners = new Set<PeerTransportListener>();

  onStatusChange(listener: PeerStatusListener): void {
    this.statusListeners.add(listener);
  }

  onTransportReady(listener: PeerTransportListener): void {
    this.transportListeners.add(listener);
  }

  onDisconnect(listener: PeerDisconnectListener): void {
    this.disconnectListeners.add(listener);
  }

  getTransports(): DataChannelTransport[] {
    return Array.from(this.peers.values())
      .map((p) => p.transport)
      .filter((t): t is DataChannelTransport => t !== undefined);
  }

  /** Start a new outgoing connection. Returns the offer blob to hand off. */
  async createOffer(): Promise<{ peerId: string; offerBlob: string }> {
    const peerId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const connection = new PeerConnection();
    const managed: ManagedPeer = { id: peerId, connection };
    this.peers.set(peerId, managed);

    connection.raw.onconnectionstatechange = () => {
      const currentState = connection.connectionState;
      for (const l of this.statusListeners) l(peerId, currentState);
      if (currentState === "failed" || currentState === "closed") {
        const wasManaged = this.peers.get(peerId);
        this.peers.delete(peerId);
        for (const l of this.disconnectListeners) l(peerId, wasManaged?.transport);
      }
    };

    const transport = DataChannelTransport.createInitiator(connection);
    managed.transport = transport;
    for (const l of this.transportListeners) l(peerId, transport);

    await connection.createOffer();
    await waitForIceGatheringComplete(connection);
    return { peerId, offerBlob: encodeSignal(connection.raw.localDescription!) };
  }

  /** Accept an incoming offer. Returns the answer blob to hand back. */
  async acceptOffer(offerBlob: string): Promise<{ peerId: string; answerBlob: string }> {
    const peerId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const connection = new PeerConnection();
    const managed: ManagedPeer = { id: peerId, connection };
    this.peers.set(peerId, managed);

    connection.raw.onconnectionstatechange = () => {
      const currentState = connection.connectionState;
      for (const l of this.statusListeners) l(peerId, currentState);
      if (currentState === "failed" || currentState === "closed") {
        const wasManaged = this.peers.get(peerId);
        this.peers.delete(peerId);
        for (const l of this.disconnectListeners) l(peerId, wasManaged?.transport);
      }
    };

    connection.raw.ondatachannel = (event) => {
      const transport = DataChannelTransport.fromExisting(event.channel);
      managed.transport = transport;
      for (const l of this.transportListeners) l(peerId, transport);
    };

    const remoteOffer = decodeSignal(offerBlob);
    await connection.createAnswer(remoteOffer);
    await waitForIceGatheringComplete(connection);
    return { peerId, answerBlob: encodeSignal(connection.raw.localDescription!) };
  }

  /** Complete an outgoing connection by supplying the peer's answer. */
  async acceptAnswer(peerId: string, answerBlob: string): Promise<void> {
    const managed = this.peers.get(peerId);
    if (!managed) throw new Error(`Unknown peer id: ${peerId}`);
    const remoteAnswer = decodeSignal(answerBlob);
    await managed.connection.acceptAnswer(remoteAnswer);
  }

  getPeerIds(): string[] {
    return Array.from(this.peers.keys());
  }
}
