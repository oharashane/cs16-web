import {loadAsync} from 'jszip'
import filesystemURL from 'xash3d-fwgs/filesystem_stdio.wasm?url'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import menuURL from 'cs16-client/cl_dll/menu_emscripten_wasm32.wasm?url'
import clientURL from 'cs16-client/cl_dll/client_emscripten_wasm32.wasm?url'
import serverURL from 'cs16-client/dlls/cs_emscripten_wasm32.so?url'
import gles3URL from 'xash3d-fwgs/libref_gles3compat.wasm?url'
import {Xash3DWebRTC} from "./webrtc";

let usernamePromiseResolve: (name: string) => void
const usernamePromise = new Promise<string>(resolve => {
    usernamePromiseResolve = resolve
})

async function main() {
    const x = new Xash3DWebRTC({
        canvas: document.getElementById('canvas') as HTMLCanvasElement,
        module: {
            arguments: ['-windowed', '-game', 'cstrike'],
        },
        libraries: {
            filesystem: filesystemURL,
            xash: xashURL,
            menu: menuURL,
            server: serverURL,
            client: clientURL,
            render: {
                gles3compat: gles3URL,
            }
        },
        filesMap: {
            'dlls/cs_emscripten_wasm32.so': serverURL,
            '/rwdir/filesystem_stdio.so': filesystemURL,
        },
    });

    const [zip] = await Promise.all([
        (async () => {
            const res = await fetch('valve.zip')
            return await loadAsync(await res.arrayBuffer());
        })(),
        x.init(),
    ])

    await Promise.all(Object.entries(zip.files).map(async ([filename, file]) => {
        if (file.dir) return;

        const path = '/rodir/' + filename;
        const dir = path.split('/').slice(0, -1).join('/');

        x.em.FS.mkdirTree(dir);
        x.em.FS.writeFile(path, await file.async("uint8array"));
    }))

    x.em.FS.chdir('/rodir')

    document.getElementById('logo')!.style.animationName = 'pulsate-end'
    document.getElementById('logo')!.style.animationFillMode = 'forwards'
    document.getElementById('logo')!.style.animationIterationCount = '1'
    document.getElementById('logo')!.style.animationDirection = 'normal'

    const username = await usernamePromise
    x.main()
    x.Cmd_ExecuteString('_vgui_menus 0')
    if (!window.matchMedia('(hover: hover)').matches) {
        x.Cmd_ExecuteString('touch_enable 1')
    }
    x.Cmd_ExecuteString(`name "${username}"`)
    
    // Parse URL parameters for server connection
    const urlParams = new URLSearchParams(window.location.search);
    const connectParam = urlParams.get('connect');
    const serverParam = urlParams.get('server');
    
    let connectTo = connectParam;
    
    if (!connectTo) {
        // Fetch the default server from the server list API
        try {
            const response = await fetch('/api/servers');
            const data = await response.json();
            if (data && data.servers) {
                // Get the first server from the servers object
                const serverKeys = Object.keys(data.servers);
                if (serverKeys.length > 0) {
                    const firstServer = data.servers[serverKeys[0]];
                    connectTo = `${firstServer.host}:${firstServer.port}`;
                } else {
                    connectTo = '127.0.0.1:27015';
                }
            } else {
                connectTo = '127.0.0.1:27015';
            }
        } catch (error) {
            console.warn('Failed to fetch server list, using fallback:', error);
            connectTo = '127.0.0.1:27015';
        }
    }
    
    console.log(`🔗 Connecting to: ${connectTo}`);
    x.Cmd_ExecuteString(`connect ${connectTo}`)

    window.addEventListener('beforeunload', (event) => {
        event.preventDefault();
        event.returnValue = '';
        return '';
    });
}

const username = localStorage.getItem('username')
if (username) {
    (document.getElementById('username') as HTMLInputElement).value = username
}

(document.getElementById('form') as HTMLFormElement).addEventListener('submit', (e) => {
    e.preventDefault()
    const username = (document.getElementById('username') as HTMLInputElement).value
    localStorage.setItem('username', username);
    (document.getElementById('form') as HTMLFormElement).style.display = 'none'
    usernamePromiseResolve(username)
})

main()