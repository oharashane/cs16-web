import { Net, Packet, Xash3D, Xash3DOptions } from 'xash3d-fwgs';

// The engine believes it is talking UDP to a server at this address. It is not: the
// bytes go over a data channel to the relay, which owns a real UDP socket. But every
// packet the relay sends back is stamped as coming from here, because the engine only
// accepts datagrams from the address it connected to.
export const FAKE_SERVER = { ip: [127, 0, 0, 1] as [number, number, number, number], port: 8080 };
export const CONNECT_COMMAND = `connect ${FAKE_SERVER.ip.join('.')}:${FAKE_SERVER.port}`;

export type ConnectionEvent = 'signalling' | 'connected' | 'failed' | 'closed';

/**
 * Xash3D with its network plugged into the relay: a WebSocket for the WebRTC offer and
 * answer, two unreliable data channels for the game. Adapted from upstream's
 * docker/cs-web-server client; no microphone, and the server is a parameter.
 */
export class Xash3DWebRTC extends Xash3D {
    private ws?: WebSocket;
    private peer?: RTCPeerConnection;
    private read?: RTCDataChannel;
    private opened = 0;
    private ready?: () => void;
    private pendingCandidates: RTCIceCandidateInit[] = [];
    private haveRemote = false;

    constructor(private readonly signalUrl: string, private readonly onEvent: (event: ConnectionEvent, detail?: string) => void, opts?: Xash3DOptions) {
        super(opts);
        this.net = new Net(this);
    }

    /** Boots the engine and connects to the relay at the same time; resolves when both channels are open. */
    async init() {
        await Promise.all([super.init(), this.connect()]);
    }

    /** Called by the engine's Net for every outgoing datagram. */
    sendto(packet: Packet) {
        // A view onto the engine's heap; send() copies it out synchronously.
        if (this.read?.readyState === 'open') this.read.send(packet.data as unknown as ArrayBufferView<ArrayBuffer>);
    }

    private connect() {
        return new Promise<void>(resolve => {
            this.ready = resolve;
            this.onEvent('signalling');
            this.ws = new WebSocket(this.signalUrl);
            this.ws.onopen = () => this.startPeer();
            this.ws.onerror = () => this.onEvent('failed', 'the relay did not answer');
            this.ws.onmessage = async (message) => {
                const { event, data } = JSON.parse(message.data);
                if (event === 'offer') await this.answer(data);
                else if (event === 'candidate') {
                    this.pendingCandidates.push(data);
                    if (this.haveRemote) this.flushCandidates();
                }
            };
        });
    }

    private startPeer() {
        this.peer = new RTCPeerConnection();
        this.peer.onicecandidate = e => {
            if (e.candidate) this.send('candidate', e.candidate.toJSON());
        };
        this.peer.onconnectionstatechange = () => {
            const state = this.peer?.connectionState;
            if (state === 'connected') this.onEvent('connected');
            else if (state === 'failed') this.onEvent('failed', 'the WebRTC connection failed');
            else if (state === 'closed' || state === 'disconnected') this.onEvent('closed');
        };
        this.peer.ondatachannel = e => {
            const channel = e.channel;
            channel.binaryType = 'arraybuffer';
            if (channel.label === 'write') {
                channel.onmessage = m => (this.net as Net).incoming.enqueue({ ...FAKE_SERVER, data: new Int8Array(m.data as ArrayBuffer) });
            }
            channel.onopen = () => {
                if (channel.label === 'read') this.read = channel;
                if (++this.opened === 2 && this.ready) { const r = this.ready; this.ready = undefined; r(); }
            };
        };
    }

    private async answer(offer: RTCSessionDescriptionInit) {
        if (!this.peer) return;
        await this.peer.setRemoteDescription(offer);
        const answer = await this.peer.createAnswer();
        await this.peer.setLocalDescription(answer);
        this.send('answer', answer);
        this.haveRemote = true;
        this.flushCandidates();
    }

    private flushCandidates() {
        const candidates = this.pendingCandidates;
        this.pendingCandidates = [];
        for (const c of candidates) this.peer?.addIceCandidate(c).catch(() => this.pendingCandidates.push(c));
    }

    private send(event: string, data: unknown) {
        this.ws?.send(JSON.stringify({ event, data }));
    }
}
