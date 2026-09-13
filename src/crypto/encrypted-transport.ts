import type { Transport, MessageListener } from "../network/data-channel-transport.js";
import { generateKeyPair, exportPublicKey, importPublicKey, deriveSharedKey } from "./keys.js";
import { encryptMessage, decryptMessage } from "./cipher.js";

type HandshakeMessage = { kind: "handshake"; publicKey: string };
type EncryptedMessage = { kind: "encrypted"; payload: string };

export class EncryptedTransport implements Transport {
  private listeners = new Set<MessageListener>();
  private sharedKey: CryptoKey | undefined;
  private sendQueue: string[] = [];
  private ready = false;
  private keyPairPromise: Promise<{ publicKey: CryptoKey; privateKey: CryptoKey }>;

  constructor(private readonly underlying: Transport) {
    this.keyPairPromise = generateKeyPair();
    underlying.onMessage((raw) => this.handleRaw(raw));
    this.startHandshake();
  }

  private async startHandshake(): Promise<void> {
    const { publicKey } = await this.keyPairPromise;
    const exported = await exportPublicKey(publicKey);
    this.underlying.send(JSON.stringify({ kind: "handshake", publicKey: exported } satisfies HandshakeMessage));
  }

  private async handleRaw(raw: string): Promise<void> {
    let message: HandshakeMessage | EncryptedMessage;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }

    if (message.kind === "handshake") {
      const { privateKey } = await this.keyPairPromise;
      const peerPublicKey = await importPublicKey(message.publicKey);
      this.sharedKey = await deriveSharedKey(privateKey, peerPublicKey);
      this.ready = true;
      const queued = this.sendQueue;
      this.sendQueue = [];
      for (const plaintext of queued) {
        const encrypted = await encryptMessage(this.sharedKey, plaintext);
        this.underlying.send(JSON.stringify({ kind: "encrypted", payload: encrypted } satisfies EncryptedMessage));
      }
    } else if (message.kind === "encrypted") {
      if (!this.sharedKey) return;
      try {
        const plaintext = await decryptMessage(this.sharedKey, message.payload);
        for (const l of this.listeners) l(plaintext);
      } catch (err) {
        console.error("[encrypted-transport] rejected tampered or corrupt message:", err);
      }
    }
  }

  send(data: string): void {
    if (this.ready && this.sharedKey) {
      encryptMessage(this.sharedKey, data).then((encrypted) => {
        this.underlying.send(JSON.stringify({ kind: "encrypted", payload: encrypted } satisfies EncryptedMessage));
      });
    } else {
      this.sendQueue.push(data);
    }
  }

  onMessage(listener: MessageListener): void {
    this.listeners.add(listener);
  }
}