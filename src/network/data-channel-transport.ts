import type { PeerConnection } from "./peer-connection";

export type MessageListener = (data: string) => void;

/**
 * Wraps an RTCDataChannel so callers can send() immediately without
 * worrying about connection state — messages sent before the channel
 * opens are queued and flushed once it does. This matters a lot in
 * practice: local edits can happen before the peer connection
 * finishes its handshake, and we don't want to drop them.
 */
export class DataChannelTransport {
  private channel: RTCDataChannel;
  private queue: string[] = [];
  private isOpen = false;
  private messageListeners = new Set<MessageListener>();

  // The peer that calls createOffer() also owns creating the
  // channel; the answering peer receives it via ondatachannel
  // (see fromExisting below).
  static createInitiator(peer: PeerConnection): DataChannelTransport {
    const channel = peer.raw.createDataChannel("crdt-sync", {
      ordered: true, // we need ops to arrive in send order for the Lamport clock reasoning to hold
    });
    return new DataChannelTransport(channel);
  }

  static fromExisting(channel: RTCDataChannel): DataChannelTransport {
    return new DataChannelTransport(channel);
  }

  private constructor(channel: RTCDataChannel) {
    this.channel = channel;

    this.channel.onopen = () => {
      this.isOpen = true;
      for (const msg of this.queue) this.channel.send(msg);
      this.queue = [];
    };

    this.channel.onmessage = (event) => {
      for (const listener of this.messageListeners) listener(event.data);
    };
  }

  send(data: string): void {
    if (this.isOpen) {
      this.channel.send(data);
    } else {
      this.queue.push(data);
    }
  }

  onMessage(listener: MessageListener): void {
    this.messageListeners.add(listener);
  }
}
