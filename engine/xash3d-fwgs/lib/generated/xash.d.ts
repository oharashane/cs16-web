import {EmNet} from "../net";

export type FS = {
    mkdir(path: string): void
    mkdirTree(path: string): void
    writeFile(path: string, data: Uint8Array): void
    chdir(path: string): void
    syncfs(cb: () => void): void
}

declare type SOCK = {
    family: number,
    type: number,
    protocol: number,
    [key: string]: unknown
};

declare type SOCKFS = {
    createSocket(
        family: number,
        type: number,
        protocol: number
    ): SOCK;
};

declare type DNS = {
  address_map: {
    id: number;
    addrs: Record<string, string>;
    names: Record<string, string>;
  };
  lookup_name(name: string): string;
  lookup_addr(addr: string): string | null;
};

export type ModuleCallbacks = {
    gameReady?: () => void
    syncFS?: (data: {path: string, op: string}) => void
}

export type Module = {
    ccall: (
        ident: string,
        returnType: 'number' | 'string' | null,
        argTypes: Array<'number' | 'string'>,
        args: Array<number | string>
    ) => number | string | void
    arguments?: string[]
    canvas: HTMLCanvasElement
    ctx: WebGL2RenderingContext | CanvasRenderingContext2D | null
    dynamicLibraries?: string[]
    onRuntimeInitialized?: () => void
    net?: EmNet
    callbacks?: ModuleCallbacks
    locateFile?: (path: string) => string
    print?: (log: string) => void
    printErr?: (log: string) => void
    [key: string]: unknown
}

export type Sockaddr = { family: number; addr: string; port: number }

export type Em = {
    Module: Module
    FS: FS,
    SOCKFS: SOCKFS,
    DNS: DNS,
    start: () => void
    HEAPU32: Int8Array
    HEAP32: Int8Array
    HEAP16: Int8Array
    HEAP8: Int8Array
    HEAPU8: Int8Array
    addFunction: (func: (...params: any[]) => unknown, args: string) => number
    removeFunction: (ptr: number) => void
    getValue: (
        ptr: number,
        type: 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32' | 'i64' | 'u64' | 'float' | 'double' | '*'
    ) => number
    setValue: (ptr: number, value: number | bigint, type: string, noSafe?: boolean) => void
    ___errno_location: () => number
    writeArrayToMemory: (array: number[] | Uint8Array, buffer: number) => void
    intArrayFromString: (str: string, dontAddNull?: boolean) => number[]
    writeSockaddr: (saPtr: number, family: number, addr: string | string[] | number[], port: number, addrlen?: number) => number
    readSockaddr: (saPtr: number, saLen: number) => Sockaddr
    AsciiToString: (ptr: number) => string
    _malloc: (size: number) => number
    addRunDependency: (id: string) => void
    removeRunDependency: (id: string) => void
}

const Xash: (moduleArg?: Partial<Module>) => Promise<Em>
export default Xash
