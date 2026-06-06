// Wraps RTCPeerConnection with just the primitives we need. Nothing
// here knows about signaling yet — that's a deliberately separate
// concern, wired up on Day 6.

export type IceCandidateListener = (candidate: RTCIceCandidate) => void;

export class PeerConnection {
  readonly raw: RTCPeerConnection;
  private iceListeners = new Set<IceCandidateListener>();

  constructor() {
    // Public STUN server: lets a peer discover its own reachable
    // address from outside its own NAT. No TURN server yet — that
    // means this won't traverse every NAT type, but it's enough for
    // most home/office networks and is the right starting point.
    this.raw = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    this.raw.onicecandidate = (event) => {
      if (event.candidate) {
        for (const listener of this.iceListeners) listener(event.candidate);
      }
    };
  }

  onIceCandidate(listener: IceCandidateListener): void {
    this.iceListeners.add(listener);
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.raw.createOffer();
    await this.raw.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(remoteOffer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.raw.setRemoteDescription(remoteOffer);
    const answer = await this.raw.createAnswer();
    await this.raw.setLocalDescription(answer);
    return answer;
  }

  async acceptAnswer(remoteAnswer: RTCSessionDescriptionInit): Promise<void> {
    await this.raw.setRemoteDescription(remoteAnswer);
  }

  async addRemoteIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    await this.raw.addIceCandidate(candidate);
  }

  get connectionState(): RTCPeerConnectionState {
    return this.raw.connectionState;
  }
}
