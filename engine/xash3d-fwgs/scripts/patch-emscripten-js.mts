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

    save() {
        return fs.writeFile('./lib/generated/xash.js', this.data)
    }
}

const FILE_PATH = './dist/raw.js'

async function main() {
    const raw = await fs.readFile(FILE_PATH, 'utf8')

    await fs.writeFile(FILE_PATH, raw)
    const f = new CompileFile(raw)

    // fix CJS export to EJS
    f.replaceAll(`if(typeof exports==="object"&&typeof module==="object"){module.exports=Xash3D;module.exports.default=Xash3D}else if(typeof define==="function"&&define["amd"])define([],()=>Xash3D);`,
        'export default Xash3D;')

    // add on start async FS callback
    f.deleteAll('run();')
    f.deleteAll(';if(runtimeInitialized){moduleRtn=Module}else{moduleRtn=new Promise((resolve,reject)=>{readyPromiseResolve=resolve;readyPromiseReject=reject})}')

    // return engine funcs instead of runtime promise
    f.replaceAll('return moduleRtn', `
        return {
            Module,
            FS,
            SOCKFS,
            DNS,
            HEAPU32,
            HEAP32,
            HEAP16,
            HEAP8,
            HEAPU8,
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
            start: () => {
                run();
                if (runtimeInitialized) {
                    moduleRtn = Module
                } else {
                    moduleRtn = new Promise((resolve, reject) => {
                        readyPromiseResolve = resolve;
                        readyPromiseReject = reject
                    })
                }
            },
        };
    `)

    await f.save()
}

main()
