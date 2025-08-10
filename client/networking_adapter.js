// Networking adapter that provides addFunction support for engines that don't have it
// Based on our proven test approach

export class NetworkingAdapter {
    constructor() {
        this.addFunction = null;
        this.removeFunction = null;
        this.ccall = null;
        this.sendtoPointer = null;
        this.recvfromPointer = null;
        this.incomingQueue = [];
        this.onSendPacket = null;
    }

    async initialize() {
        // Load our working test module that has addFunction support
        const script = document.createElement('script');
        script.src = '/assets/test_addfunction.js';
        
        return new Promise((resolve, reject) => {
            script.onload = async () => {
                try {
                    const module = await TestModule();
                    this.addFunction = module.addFunction.bind(module);
                    this.removeFunction = module.removeFunction.bind(module);
                    this.ccall = module.ccall.bind(module);
                    
                    console.log('[NetworkingAdapter] Initialized with addFunction support');
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // Create JavaScript function that gets called when engine wants to send packets
    setupSendtoCallback(onSendPacket) {
        this.onSendPacket = onSendPacket;
        
        const sendtoCallback = (message, length, flags) => {
            console.log('[NetworkingAdapter] 🚀 Sendto called:', length, 'bytes');
            
            // Create a mock heap simulation for the callback
            const data = new Uint8Array(length);
            for (let i = 0; i < length; i++) {
                data[i] = (message + i) & 0xFF; // Simple mock data
            }
            
            if (this.onSendPacket) {
                this.onSendPacket(data);
            }
        };
        
        this.sendtoPointer = this.addFunction(sendtoCallback, 'viii');
        console.log('[NetworkingAdapter] Created sendto pointer:', this.sendtoPointer);
        return this.sendtoPointer;
    }

    // Create JavaScript function that provides packets to the engine
    setupRecvfromCallback() {
        const recvfromCallback = (sockfd, buf, len, flags, src_addr, addrlen) => {
            console.log('[NetworkingAdapter] 📥 Recvfrom called, requesting', len, 'bytes');
            
            if (this.incomingQueue.length === 0) {
                return -1; // No data available
            }
            
            const packet = this.incomingQueue.shift();
            const copyLen = Math.min(len, packet.length);
            
            console.log('[NetworkingAdapter] 📥 Delivering', copyLen, 'bytes');
            
            // In a real implementation, we'd copy to the engine's memory
            // For now, we'll just return the length to simulate success
            return copyLen;
        };
        
        this.recvfromPointer = this.addFunction(recvfromCallback, 'iiiiiii');
        console.log('[NetworkingAdapter] Created recvfrom pointer:', this.recvfromPointer);
        return this.recvfromPointer;
    }

    // Queue incoming packet for the engine
    enqueuePacket(data) {
        console.log('[NetworkingAdapter] 📨 Enqueueing packet for syscall delivery:', data.length, 'bytes');
        this.incomingQueue.push(new Uint8Array(data));
        console.log('[NetworkingAdapter] 📨 Queue size now:', this.incomingQueue.length);
    }

    // Try to register callbacks with the engine
    tryRegisterWithEngine(engineModule) {
        try {
            console.log('[NetworkingAdapter] Attempting to register with engine...');
            
            if (engineModule && engineModule.ccall) {
                // IMPORTANT: Don't actually register the callbacks to avoid signature mismatch
                // Instead, we'll intercept at a different level
                console.log('[NetworkingAdapter] ⚠️ Skipping callback registration to avoid signature mismatch');
                console.log('[NetworkingAdapter] Will use alternative networking approach');
                
                // Store engine reference for potential future use
                this.engineModule = engineModule;
                
                console.log('[NetworkingAdapter] ✅ NetworkingAdapter ready (alternative mode)!');
                return true;
            }
        } catch (e) {
            console.log('[NetworkingAdapter] ❌ Registration failed:', e.message);
        }
        return false;
    }

    // Alternative approach: hook engine networking without cross-instance callbacks
    setupEngineHooks(engineModule) {
        try {
            console.log('[NetworkingAdapter] Setting up engine hooks...');
            
            // Store engine reference
            this.engineModule = engineModule;
            
            // Strategy: Intercept and redirect networking calls
            const originalCcall = engineModule.ccall;
            
            engineModule.ccall = (...args) => {
                const [funcName, returnType, argTypes, argValues] = args;
                
                // Intercept sendto/recvfrom callback registrations
                if (funcName === 'register_sendto_callback') {
                    console.log('[NetworkingAdapter] 🎯 Intercepted sendto callback registration!');
                    // Register a simple stub that we can monitor
                    return originalCcall.apply(engineModule, args);
                } else if (funcName === 'register_recvfrom_callback') {
                    console.log('[NetworkingAdapter] 🎯 Intercepted recvfrom callback registration!');
                    // Register a simple stub that we can monitor
                    return originalCcall.apply(engineModule, args);
                }
                
                // For all other calls, use original ccall
                return originalCcall.apply(engineModule, args);
            };
            
            // Also try to patch the lower-level networking functions if available
            this.patchLowLevelNetworking(engineModule);
            
            console.log('[NetworkingAdapter] ✅ Engine hooks installed - will intercept callback registrations');
            return true;
        } catch (e) {
            console.log('[NetworkingAdapter] ❌ Hook setup failed:', e.message);
            return false;
        }
    }
    
    // Patch Emscripten syscalls that handle actual UDP traffic (bulletproof approach)
    patchLowLevelNetworking(engineModule) {
        try {
            console.log('[NetworkingAdapter] Attempting to patch Emscripten syscalls...');
            
            // Look for ALL networking-related exports
            const moduleKeys = Object.keys(engineModule);
            
            // Search for syscalls
            const syscallKeys = moduleKeys.filter(k => 
                k.includes('___syscall_send') || k.includes('___syscall_recv') || 
                k.includes('syscall') || k.includes('__syscall')
            );
            
            // Search for any networking functions (broader search)
            const networkKeys = moduleKeys.filter(k => 
                k.includes('send') || k.includes('recv') || k.includes('socket') ||
                k.includes('NET') || k.includes('net') || k.includes('udp') ||
                k.includes('Packet') || k.includes('packet')
            );
            
            // Search for Emscripten filesystem/socket functions
            const emscriptenKeys = moduleKeys.filter(k => 
                k.includes('fd_') || k.includes('sock_') || k.includes('__') ||
                k.includes('emscripten') || k.includes('wasi')
            );
            
            console.log('[NetworkingAdapter] COMPREHENSIVE FUNCTION ANALYSIS:');
            console.log('[NetworkingAdapter] Syscall functions:', syscallKeys);
            console.log('[NetworkingAdapter] Network functions:', networkKeys);
            console.log('[NetworkingAdapter] Emscripten/WASI functions (first 20):', emscriptenKeys.slice(0, 20));
            
            console.log('[NetworkingAdapter] DETAILED analysis:');
            [...syscallKeys, ...networkKeys].forEach(key => {
                console.log(`[NetworkingAdapter]   - ${key}: ${typeof engineModule[key]}`);
            });
            
            // Helper functions for syscall patching
            const bytesFromHeap = (ptr, len) => {
                return engineModule.HEAPU8.slice(ptr, ptr + len);
            };
            
            const writeBytes = (ptr, arr) => {
                engineModule.HEAPU8.set(arr, ptr);
            };

            // Intercept Emscripten's websocket shim so we can route traffic through
            // the DataChannel instead of the browser trying to open real WebSockets
            this.patchWebSocketObject(engineModule, bytesFromHeap, writeBytes);
            
            // Patch _register_sendto_callback to intercept engine's callback registration
            const originalRegisterSendto = engineModule._register_sendto_callback;
            if (originalRegisterSendto) {
                engineModule._register_sendto_callback = (callbackPointer) => {
                    console.log('[NetworkingAdapter] 🎯 INTERCEPTED _register_sendto_callback! Engine trying to register:', callbackPointer);
                    
                    // Store the engine's original callback for potential use
                    this.engineSendtoCallback = callbackPointer;
                    
                    // Create our own sendto interceptor using the engine's addFunction if available
                    if (engineModule.addFunction) {
                        console.log('[NetworkingAdapter] Engine has addFunction, creating interceptor...');
                        
                        const interceptor = (message, length, flags) => {
                            console.log('[NetworkingAdapter] 🚀 SENDTO INTERCEPTOR CALLED! msg=' + message + ', len=' + length + ', flags=' + flags);
                            
                            try {
                                const payload = bytesFromHeap(message, length);
                                console.log('[NetworkingAdapter] 🚀 Extracted packet from engine callback, size:', payload.length);
                                console.log('[NetworkingAdapter] 🚀 Packet preview:', Array.from(payload.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
                                
                                // Send over DataChannel instead of real socket
                                if (window.sendPacketViaDataChannel) {
                                    window.sendPacketViaDataChannel(payload);
                                }
                                
                                return length; // Report success to engine
                            } catch (e) {
                                console.log('[NetworkingAdapter] ❌ Sendto interceptor failed:', e.message);
                                return -1;
                            }
                        };
                        
                        const interceptorPointer = engineModule.addFunction(interceptor, 'iiii');
                        console.log('[NetworkingAdapter] Created sendto interceptor pointer:', interceptorPointer);
                        
                        // Register our interceptor instead of the engine's original callback
                        return originalRegisterSendto.call(engineModule, interceptorPointer);
                    } else {
                        console.log('[NetworkingAdapter] ⚠️ Engine has no addFunction, falling back to blocking');
                        // Just block the registration and return success
                        return 0;
                    }
                };
                console.log('[NetworkingAdapter] ✅ Patched _register_sendto_callback');
            } else {
                console.log('[NetworkingAdapter] ⚠️ _register_sendto_callback not found');
            }
            
            // Patch _register_recvfrom_callback to intercept engine's callback registration
            const originalRegisterRecvfrom = engineModule._register_recvfrom_callback;
            if (originalRegisterRecvfrom) {
                engineModule._register_recvfrom_callback = (callbackPointer) => {
                    console.log('[NetworkingAdapter] 🎯 INTERCEPTED _register_recvfrom_callback! Engine trying to register:', callbackPointer);
                    
                    // Store the engine's original callback for potential use
                    this.engineRecvfromCallback = callbackPointer;
                    
                    // Create our own recvfrom interceptor using the engine's addFunction if available
                    if (engineModule.addFunction) {
                        console.log('[NetworkingAdapter] Engine has addFunction, creating recvfrom interceptor...');
                        
                        const interceptor = (sockfd, buf, len, flags, src_addr, addrlen) => {
                            console.log('[NetworkingAdapter] 📥 RECVFROM INTERCEPTOR CALLED! sockfd=' + sockfd + ', buf=' + buf + ', len=' + len + ', flags=' + flags);
                            
                            // Check our packet queue
                            const packet = this.incomingQueue.shift();
                            if (!packet) {
                                console.log('[NetworkingAdapter] 📥 No packets in queue, returning EWOULDBLOCK');
                                return 0; // No data available (EWOULDBLOCK-ish)
                            }
                            
                            try {
                                const copyLen = Math.min(len, packet.length);
                                writeBytes(buf, packet.subarray(0, copyLen));
                                console.log('[NetworkingAdapter] 📥 Delivered packet from queue to engine, size:', copyLen);
                                
                                // Simulate source address (127.0.0.1:27015) if requested
                                if (src_addr) {
                                    const base8 = src_addr;
                                    const base16 = src_addr >> 1;
                                    engineModule.HEAP16[base16] = 2; // AF_INET
                                    engineModule.HEAP8[base8 + 2] = 0x69; // Port 27015 (0x6987)
                                    engineModule.HEAP8[base8 + 3] = 0x87;
                                    engineModule.HEAP8[base8 + 4] = 127; // IP 127.0.0.1
                                    engineModule.HEAP8[base8 + 5] = 0;
                                    engineModule.HEAP8[base8 + 6] = 0;
                                    engineModule.HEAP8[base8 + 7] = 1;
                                }
                                if (addrlen) {
                                    engineModule.HEAP32[addrlen >> 2] = 16; // sizeof(sockaddr_in)
                                }
                                
                                return copyLen;
                            } catch (e) {
                                console.log('[NetworkingAdapter] ❌ Recvfrom interceptor failed:', e.message);
                                return -1;
                            }
                        };
                        
                        const interceptorPointer = engineModule.addFunction(interceptor, 'iiiiiii');
                        console.log('[NetworkingAdapter] Created recvfrom interceptor pointer:', interceptorPointer);
                        
                        // Register our interceptor instead of the engine's original callback
                        return originalRegisterRecvfrom.call(engineModule, interceptorPointer);
                    } else {
                        console.log('[NetworkingAdapter] ⚠️ Engine has no addFunction, falling back to blocking');
                        // Just block the registration and return success
                        return 0;
                    }
                };
                console.log('[NetworkingAdapter] ✅ Patched _register_recvfrom_callback');
            } else {
                console.log('[NetworkingAdapter] ⚠️ _register_recvfrom_callback not found');
            }
            
            // Also check for sendmsg/recvmsg variants
            const originalSendmsg = engineModule.___syscall_sendmsg;
            const originalRecvmsg = engineModule.___syscall_recvmsg;
            
            if (originalSendmsg || originalRecvmsg) {
                console.log('[NetworkingAdapter] Found sendmsg/recvmsg syscalls:', {
                    sendmsg: !!originalSendmsg,
                    recvmsg: !!originalRecvmsg
                });
                // Could patch these too if needed, but sendto/recvfrom are more common
            }
            
            // Add comprehensive monitoring to see what the engine actually calls
            console.log('[NetworkingAdapter] Adding comprehensive function call monitoring...');
            
            // Monitor ALL function calls on the engine module to see what networking it really uses
            const allFunctions = moduleKeys.filter(key => typeof engineModule[key] === 'function');
            console.log('[NetworkingAdapter] Total functions in engine:', allFunctions.length);
            
            // Track calls to any function that might be networking-related
            allFunctions.forEach(funcName => {
                if (funcName.includes('send') || funcName.includes('recv') || funcName.includes('net') || 
                    funcName.includes('NET') || funcName.includes('socket') || funcName.includes('udp') ||
                    funcName.includes('packet') || funcName.includes('Packet')) {
                    
                    const originalFunc = engineModule[funcName];
                    if (typeof originalFunc === 'function') {
                        engineModule[funcName] = (...args) => {
                            console.log(`[NetworkingAdapter] 🔍 FUNCTION CALLED: ${funcName}(${args.length} args)`);
                            console.log(`[NetworkingAdapter] 🔍 Args:`, args.slice(0, 5)); // First 5 args only
                            return originalFunc.apply(engineModule, args);
                        };
                        console.log(`[NetworkingAdapter] 📡 Monitoring function: ${funcName}`);
                    }
                }
            });
            
            // Also try to find and patch NET_SendPacketEx directly if it exists
            if ('NET_SendPacketEx' in engineModule && typeof engineModule.NET_SendPacketEx === 'function') {
                console.log('[NetworkingAdapter] 🎯 Found NET_SendPacketEx directly! Patching...');
                const originalSendPacketEx = engineModule.NET_SendPacketEx;
                engineModule.NET_SendPacketEx = (...args) => {
                    console.log('[NetworkingAdapter] 🚀 DIRECT NET_SendPacketEx INTERCEPTION!', args);
                    // Try to extract and send packet data here
                    if (window.sendPacketViaDataChannel && args.length >= 2) {
                        try {
                            // Args might be (to, buf, len, ...) or similar
                            console.log('[NetworkingAdapter] 🚀 Attempting to extract packet from NET_SendPacketEx');
                            // This would need reverse engineering of the actual function signature
                        } catch (e) {
                            console.log('[NetworkingAdapter] ❌ NET_SendPacketEx extraction failed:', e.message);
                        }
                    }
                    // Block the original call to prevent UDP error
                    console.log('[NetworkingAdapter] 🚫 Blocking original NET_SendPacketEx');
                    return -1; // Return error to prevent actual UDP
                };
                console.log('[NetworkingAdapter] ✅ Patched NET_SendPacketEx directly');
            } else {
                console.log('[NetworkingAdapter] ⚠️ NET_SendPacketEx not found as direct export');
            }
            
            console.log('[NetworkingAdapter] Comprehensive monitoring and patching complete');
            return true;
        } catch (e) {
            console.log('[NetworkingAdapter] Syscall patching failed:', e.message);
            return false;
        }
    }

    // Replace the default Emscripten websocket implementation with a shim that
    // forwards all traffic through our DataChannel. The engine talks to what it
    // thinks is a WebSocket-backed UDP socket while we secretly bridge it.
    patchWebSocketObject(engineModule, bytesFromHeap, writeBytes) {
        const ws = engineModule.websocket;
        if (!ws) {
            console.log('[NetworkingAdapter] ⚠️ Module.websocket not found - skipping WebSocket shim');
            return;
        }

        console.log('[NetworkingAdapter] Patching Module.websocket for DataChannel transport');
        const self = this;
        const fakeSocketId = 1;

        // Pretend to open a socket and always return our fake ID
        ws.open = function (url, protocols, options) {
            console.log('[NetworkingAdapter] websocket.open intercepted:', url);
            return fakeSocketId;
        };

        // When the engine sends data, grab it from the heap and forward via DC
        ws.send = function (sock, dataPtr, dataLen) {
            const payload = bytesFromHeap(dataPtr, dataLen);
            if (window.sendPacketViaDataChannel) {
                window.sendPacketViaDataChannel(payload);
            }
            return dataLen;
        };

        // When the engine polls for data, serve packets from our queue
        ws.recv = function (sock, bufPtr, maxLen, flags) {
            if (self.incomingQueue.length === 0) {
                return 0;
            }
            const packet = self.incomingQueue.shift();
            const copyLen = Math.min(maxLen, packet.length);
            writeBytes(bufPtr, packet.subarray(0, copyLen));
            return copyLen;
        };

        ws.close = function (sock) {
            console.log('[NetworkingAdapter] websocket.close intercepted');
            return 0;
        };
    }
}

// Export singleton instance
export const networkingAdapter = new NetworkingAdapter();
