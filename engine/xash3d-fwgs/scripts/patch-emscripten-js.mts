import {promises as fs} from 'fs';

class CompileFile {
    private data: string

    constructor(data: string) {
        this.data = data
    }

    replaceAll(find: string, replace: string) {
        this.data = this.data.split(find).join(replace)
    }

    deleteAll(find: string) {
        this.replaceAll(find, '')
    }

    replaceRegex(find: RegExp, replace: string) {
        if (!find.test(this.data)) throw new Error(`glue patch: nothing matched ${find}`)
        this.data = this.data.replace(find, replace)
    }

    save() {
        return fs.writeFile('./lib/generated/xash.js', this.data)
    }
}

const FILE_PATH = './dist/raw.js'

async function main() {
    const raw = await fs.readFile(FILE_PATH, 'utf8')

    await fs.writeFile(FILE_PATH, raw)
    const f = new CompileFile(raw)

    // fix CJS export to EJS. Matched as a pattern, not as exact text: the published
    // script matched Closure's one-line output and silently did nothing on the debug
    // build's readable glue, and the page then failed with '"default" is not exported'.
    f.replaceRegex(/if\s*\(\s*typeof exports\s*===?\s*["']object["'][\s\S]*?define\(\[\],\s*\(\)\s*=>\s*Xash3D\);?/,
        'export default Xash3D;')

    // Two shapes of module, by Emscripten version. Up to 4.x, MODULARIZE returned a
    // "moduleRtn" that was Module or a promise of it, and run() was called bare. Since
    // 6.x the factory is an async function that awaits createWasm() and run() and returns
    // Module itself. Both must not run the engine on their own: the page unpacks the game
    // first, and start() below is what runs it.
    const modern = /await\s+run\(\);/.test(raw)

    // the top-level run() call, inline in Closure's output and on a line of its own otherwise
    f.replaceRegex(/(^|[;}\n])\s*(?:await\s+)?run\(\);/m, '$1')
    if (!modern) {
        // Both shapes Emscripten 4.x emits: Closure's one-liner and the readable form.
        // (C is an optional run of // comment lines, which the readable form has inside the else.)
        f.replaceRegex(/;?\s*if\s*\(\s*runtimeInitialized\s*\)\s*\{?\s*moduleRtn\s*=\s*Module;?\s*\}?\s*else\s*\{?\s*(?:\/\/[^\n]*\n\s*)*moduleRtn\s*=\s*new Promise\(\s*\(resolve,\s*reject\)\s*=>\s*\{\s*readyPromiseResolve\s*=\s*resolve;?\s*readyPromiseReject\s*=\s*reject;?\s*\}\s*\);?\s*\}?/, '')
    }

    // return engine funcs instead of the runtime (promise). The start() that runs the
    // engine differs by shape: 4.x re-creates the ready promise, 6.x's run() is async
    // and returns one.
    const start = modern
        ? `start: () => run(),`
        : `start: () => {
                run();
                if (runtimeInitialized) {
                    moduleRtn = Module
                } else {
                    moduleRtn = new Promise((resolve, reject) => {
                        readyPromiseResolve = resolve;
                        readyPromiseReject = reject
                    })
                }
            },`
    const exports = `
        return {
            Module,
            FS,
            SOCKFS,
            DNS,
            // Getters, not values: with ALLOW_MEMORY_GROWTH the buffer is replaced when
            // the heap grows and any typed array captured earlier is detached. A getter
            // hands back whichever view is current. (Ours; the published script returned
            // the arrays themselves, which is fine only while the heap can never grow.)
            get HEAPU32() { return HEAPU32 },
            get HEAP32() { return HEAP32 },
            get HEAP16() { return HEAP16 },
            get HEAP8() { return HEAP8 },
            get HEAPU8() { return HEAPU8 },
            getValue,
            addFunction,
            removeFunction,
            setValue,
            writeArrayToMemory,
            intArrayFromString,
            writeSockaddr,
            readSockaddr,
            AsciiToString,
            _malloc,
            addRunDependency,
            removeRunDependency,
            ${start}
        };
    `
    if (modern) {
        // The factory's own "return Module" — the last one in the file.
        f.replaceRegex(/return Module(?=\s*\}\s*\}\s*\)\s*\(\s*\)\s*;?\s*(?:export default Xash3D;)?\s*$)/, exports)
    } else {
        f.replaceAll('return moduleRtn', exports)
    }

    await f.save()
}

main()
