import { Em, Sockaddr } from "../generated/xash";
import { RollingBuffer } from "../utils";
import { EmNet } from "./emNet";
import { ErrNoLocation } from "../xash3d";

export interface NetOptions {
    maxPackets: number;
    hostname: string;
    hostID: number;
}

/**
 * Represents a network packet with raw data, IP address, and port.
 */
export interface Packet {
    data: Int8Array<ArrayBufferLike>;
    ip: [number, number, number, number];
    port: number;
}

/**
 * Interface for an object that handles sending packets via `sendto`.
 */
export interface SendtoSender {
    sendto: (data: Packet) => void;
}

export interface Socket {
    id: number;
    family: number;
    type: number;
    protocol: number;
    addr?: Sockaddr;
}

/**
 * Emulates a simple network layer for Xash3D by implementing network functions
 * in a way that integrates with Emscripten’s networking model.
 */
export class Net implements EmNet {
    em?: Em;

    public readonly sender: SendtoSender;
    public readonly opts: NetOptions;

    public readonly incoming: RollingBuffer<Packet>;

    protected lastSocketID = 1000;
    protected sockets = new Map<number, Socket>();

    constructor(sender: SendtoSender, opts: Partial<NetOptions> = {}) {
        const {
            maxPackets = 128,
            hostname = "webxash3d",
            hostID = 3000,
        } = opts;
        this.sender = sender;
        this.opts = {
            hostname,
            maxPackets,
            hostID,
        };
        this.incoming = new RollingBuffer({
            maxSize: maxPackets,
        });
    }

    /**
     * Initializes the Net instance with a reference to the Emscripten module.
     * Ensures setup happens only once.
     * @param em - The Emscripten module instance
     */
    init(em: Em) {
        if (this.em) return;
        this.em = em;
    }

    readSockaddrFast(addrPtr: number): [[number, number, number, number], number] {
        const em = this.em!;
        const heapU8 = em.HEAPU8;
        const ipOffset = addrPtr + 4;
        const ip: [number, number, number, number] = [
            heapU8[ipOffset],
            heapU8[ipOffset + 1],
            heapU8[ipOffset + 2],
            heapU8[ipOffset + 3],
        ];
        const portOffset = addrPtr + 2;
        const port = (heapU8[portOffset] << 8) | heapU8[portOffset + 1];
        return [ip, port];
    }

    recvfrom(
        fd: number,
        bufPtr: number,
        bufLen: number,
        flags: number,
        sockaddrPtr: number,
        socklenPtr: number
    ): number {
        const packet = this.incoming.pull();
        if (!packet) {
            this.em!.setValue(ErrNoLocation(this.em), 73, "i32");
            return -1;
        }

        const em = this.em!;
        const data = packet.data;
        const u8 =
            data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);
        const copyLen = Math.min(bufLen, u8.length);

        // Copy data into Emscripten's memory buffer
        if (copyLen > 0) {
            em.HEAPU8.set(u8.subarray(0, copyLen), bufPtr);
        }

        // Write source IP and port into the address structure
        if (sockaddrPtr) {
            const heap8 = em.HEAP8;
            const heap16 = em.HEAP16;
            const base16 = sockaddrPtr >> 1;

            const port = packet.port;
            heap16[base16] = 2; // AF_INET

            heap8[sockaddrPtr + 2] = (port >> 8) & 0xff;
            heap8[sockaddrPtr + 3] = port & 0xff;

            heap8[sockaddrPtr + 4] = packet.ip[0];
            heap8[sockaddrPtr + 5] = packet.ip[1];
            heap8[sockaddrPtr + 6] = packet.ip[2];
            heap8[sockaddrPtr + 7] = packet.ip[3];
        }

        // Set address length if provided
        if (socklenPtr) {
            em.HEAP32[socklenPtr >> 2] = 16;
        }

        return copyLen;
    }

    sendto(
        fd: number,
        bufPtr: number,
        bufLen: number,
        flags: number,
        sockaddrPtr: number,
        socklenPtr: number,
    ): number {
        const em = this.em!;
        const heapU8 = em.HEAPU8;

        const [ip, port] = this.readSockaddrFast(sockaddrPtr);

        // bufPtr is already a direct pointer to the buffer data
        const packetCopy = heapU8.subarray(bufPtr, bufPtr + bufLen);
        this.sender.sendto({ data: packetCopy, ip, port });

        return bufLen;
    }

    sendtoBatch(
        fd: number,
        bufsPtr: number,
        lensPtr: number,
        count: number,
        flags: number,
        sockaddrPtr: number,
        socklenPtr: number
    ): number {
        const em = this.em!;
        const heap32 = em.HEAP32;
        const heapU8 = em.HEAPU8;

        let totalSize = 0;
        const [ip, port] = this.readSockaddrFast(sockaddrPtr);

        for (let i = 0; i < count; ++i) {
            const size = heap32[(lensPtr >> 2) + i];
            const packetPtr = heap32[(bufsPtr >> 2) + i];
            const slice = heapU8.subarray(packetPtr, packetPtr + size);
            this.sender.sendto({
                data: slice,
                port,
                ip
            })

            totalSize += slice.length;
        }

        return totalSize;
    }

    socket(family: number, type: number, protocol: number): number {
        const id = this.lastSocketID;
        this.sockets.set(id, { id, family, type, protocol });
        this.lastSocketID += 1;
        return id;
    }

    gethostbyname(hostnamePtr: number): number {
        return 0;
    }

    gethostname(namePtr: number, namelenPtr: number): number {
        this.em!.writeArrayToMemory(
            this.em!.intArrayFromString(
                `${this.opts.hostname!}.${this.opts.hostID}`,
                true
            ),
            namePtr
        );
        return 0;
    }

    getsockname(fd: number, sockaddrPtr: number, socklenPtr: number): number {
        const sock = this.sockets.get(fd);
        if (!sock) return -1;
        this.em!.writeSockaddr(
            sockaddrPtr,
            sock.family,
            sock.addr?.addr ?? "0.0.0.0",
            sock.addr?.port ?? 0,
            socklenPtr
        );
        return 0;
    }

    bind(fd: number, sockaddrPtr: number, socklenPtr: number) {
        const sock = this.sockets.get(fd);
        if (!sock) return -1;
        sock.addr = this.em!.readSockaddr(sockaddrPtr, socklenPtr);
        return 0;
    }

    closesocket(fd: number) {
        return this.sockets.delete(fd) ? 0 : -1;
    }

    getaddrinfo(
        hostnamePtr: number,
        restrictPrt: number,
        hintsPtr: number,
        addrinfoPtr: number
    ) {
        const host = this.em!.AsciiToString(hostnamePtr);
        const [, identity] = host.split(".", 2);
        const id = Number(identity);
        const sa = this.em!._malloc(16);
        this.em!.writeSockaddr(
            sa,
            2,
            `101.101.${(id >> 0) & 0xff}.${(id >> 8) & 0xff}`,
            0
        );

        const ai = this.em!._malloc(32);
        this.em!.HEAP32[(ai + 4) >> 2] = 2;
        this.em!.HEAP32[(ai + 8) >> 2] = 2;
        this.em!.HEAP32[(ai + 12) >> 2] = 17;
        this.em!.HEAPU32[(ai + 24) >> 2] = 0;
        this.em!.HEAPU32[(ai + 20) >> 2] = sa;
        this.em!.HEAP32[(ai + 16) >> 2] = 16;
        this.em!.HEAP32[(ai + 28) >> 2] = 0;

        this.em!.HEAPU32[addrinfoPtr >> 2] = ai;

        return 0;
    }
}
