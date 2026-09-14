import { Net, Packet, Xash3D, Xash3DOptions } from 'xash3d-fwgs';

// The engine believes it is talking UDP to a server at this address. It is not: the
// bytes go over a data channel to the relay, which owns a real UDP socket. But every
// packet the relay sends back is stamped as coming from here, because the engine only
// accepts datagrams from the address it connected to.
//
// It never changes, whichever server is being played. Which server that is, is decided
// by which relay session the transport is plugged into — so switching servers is closing
// one WebSocket and opening another, and the engine reconnects to the same fiction.
export const FAKE_SERVER = { ip: [127, 0, 0, 1] as [number, number, number, number], port: 8080 };
export const CONNECT_COMMAND = `connect ${FAKE_SERVER.ip.join('.')}:${FAKE_SERVER.port}`;

export type ConnectionEvent = 'connecting' | 'connected' | 'failed' | 'closed';

/**
 * Xash3D with its network plugged into the relay: a WebSocket for the WebRTC offer and
 * answer, two unreliable data channels for the game.
 *
 * The engine boots once and stays booted. Joining a server, leaving it and joining
 * another are all done here, so the 274 MB of game files are unpacked once per visit
 * rather than once per server.
 */
export class Xash3DWebRTC extends Xash3D {
    private ws?: WebSocket;
    private peer?: RTCPeerConnection;
    private read?: RTCDataChannel;

    /** Datagrams the game server has sent this session. A join the server refuses shows
     *  up here as a handful and then silence, which is the only way the page can tell:
     *  the engine reports a refusal to its own console and nowhere a script can read. */
    private received = 0;

    /** Set while a session is being negotiated, so a late failure can reject the join. */
    private pending?: { resolve: () => void; reject: (error: Error) => void };
    private opened = 0;
    private candidates: RTCIceCandidateInit[] = [];
    private haveRemote = false;
    /** Bumped on every join, so a stale socket's messages are ignored. */
    private generation = 0;

    constructor(private readonly onEvent: (event: ConnectionEvent, detail?: string) => void, opts?: Xash3DOptions) {
        super(opts);
        this.net = new Net(this);
    }

    /** True while the game's packets have somewhere to go. */
    get joined() { return this.read?.readyState === 'open'; }

    /** How many datagrams the game server has sent since this session opened. */
    get fromServer() { return this.received; }

    /** Called by the engine's Net for every outgoing datagram. */
    sendto(packet: Packet) {
        if (this.read?.readyState === 'open') {
            // A view onto the engine's heap; send() copies it out synchronously.
            this.read.send(packet.data as unknown as ArrayBufferView<ArrayBuffer>);
        }
    }

    /**
     * Opens a session to one game server and resolves when the game can talk to it.
     * Any previous session is torn down first, so this is both "join" and "switch".
     */
    join(port: number | string, timeoutMs = 20_000): Promise<void> {
        this.teardown();
        const generation = ++this.generation;
        this.onEvent('connecting');

        return new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => fail(new Error('the relay did not finish connecting')), timeoutMs);
            const settle = (error?: Error) => {
                clearTimeout(timer);
                this.pending = undefined;
                if (error) reject(error); else resolve();
            };
            const fail = (error: Error) => {
                if (generation !== this.generation) return;
                this.teardown();
                this.onEvent('failed', error.message);
                settle(error);
            };
            this.pending = { resolve: () => settle(), reject: fail };

            const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
            // A number is one of the house's servers by port; "host:port" is one outside it,
            // reached through the same bridge (the eye).
            const ws = new WebSocket(typeof port === 'string' ? `${protocol}://${location.host}/ws/0?to=${encodeURIComponent(port)}` : `${protocol}://${location.host}/ws/${port}`);
            this.ws = ws;
            ws.onerror = () => fail(new Error('the relay did not answer'));
            ws.onclose = () => {
                if (generation !== this.generation) return;
                // Closing after the game is up is a disconnection, not a failed join.
                if (this.pending) fail(new Error('the relay closed the connection'));
                else this.onEvent('closed');
            };
            ws.onopen = () => this.startPeer(generation);
            ws.onmessage = async (message) => {
                if (generation !== this.generation) return;
                const { event, data } = JSON.parse(message.data);
                if (event === 'offer') await this.answer(data);
                else if (event === 'candidate') {
                    this.candidates.push(data);
                    if (this.haveRemote) this.flushCandidates();
                }
            };
        });
    }

    /** Leaves the current server. The engine stays booted and its files stay in memory. */
    leave() {
        this.generation++;
        try { this.Cmd_ExecuteString('disconnect'); } catch { /* the engine may already be idle */ }
        this.teardown();
    }

    private teardown() {
        this.pending = undefined;
        this.opened = 0;
        this.received = 0;
        this.candidates = [];
        this.haveRemote = false;
        this.read = undefined;
        // Packets from the server just left must not be delivered to the next one.
        (this.net as Net).incoming.clear();
        if (this.ws) {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.close();
            this.ws = undefined;
        }
        this.peer?.close();
        this.peer = undefined;
    }

    private startPeer(generation: number) {
        const peer = new RTCPeerConnection();
        this.peer = peer;
        peer.onicecandidate = e => {
            if (e.candidate) this.send('candidate', e.candidate.toJSON());
        };
        peer.onconnectionstatechange = () => {
            if (generation !== this.generation) return;
            const state = peer.connectionState;
            if (state === 'connected') this.onEvent('connected');
            else if (state === 'failed') this.pending?.reject(new Error('the WebRTC connection failed'));
            else if (state === 'disconnected' || state === 'closed') this.onEvent('closed');
        };
        peer.ondatachannel = e => {
            const channel = e.channel;
            channel.binaryType = 'arraybuffer';
            if (channel.label === 'write') {
                channel.onmessage = m => {
                    this.received++;
                    (this.net as Net).incoming.enqueue({ ...FAKE_SERVER, data: new Int8Array(m.data as ArrayBuffer) });
                };
            }
            channel.onopen = () => {
                if (generation !== this.generation) return;
                if (channel.label === 'read') this.read = channel;
                if (++this.opened === 2) this.pending?.resolve();
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
        const candidates = this.candidates;
        this.candidates = [];
        for (const c of candidates) this.peer?.addIceCandidate(c).catch(() => this.candidates.push(c));
    }

    private send(event: string, data: unknown) {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ event, data }));
    }
}
