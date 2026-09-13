import type { PeerConnection } from "./peer-connection.js";

export type MessageListener = (data: string) => void;

export interface Transport {
  send(data: string): void;
  onMessage(listener: MessageListener): void;
}

export class DataChannelTransport implements Transport {
  private channel: RTCDataChannel;
  private queue: string[] = [];
  private isOpen = false;
  private messageListeners = new Set<MessageListener>();

  static createInitiator(peer: PeerConnection): DataChannelTransport {
    const channel = peer.raw.createDataChannel("crdt-sync", { ordered: true });
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