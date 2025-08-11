// Intercept WebSocket connections and redirect to our relay
(function() {
    const OriginalWebSocket = window.WebSocket;
    
    window.WebSocket = function(url, protocols) {
        console.log('[PLAN C] Original WebSocket URL:', url);
        
        // Redirect yohimik's WebSocket to our relay
        if (url.includes('/signal') || url.includes('/websocket')) {
            url = 'ws://localhost:8090/signal';
            console.log('[PLAN C] Redirected to relay:', url);
        }
        
        const ws = new OriginalWebSocket(url, protocols);
        
        // Log WebSocket events for debugging
        ws.addEventListener('open', () => {
            console.log('[PLAN C] WebSocket connected to:', url);
            
            // Maybe yohimik expects the server to send something first?
            // Let's wait a bit and see if any message comes from server
            setTimeout(() => {
                console.log('[PLAN C] No message from server after 2 seconds');
                
                // Try sending a test message to see what the relay expects
                console.log('[PLAN C] Attempting to send test hello message...');
                try {
                    const testMsg = {
                        type: 'hello', 
                        backend: {host: '127.0.0.1', port: 27015}
                    };
                    ws.send(JSON.stringify(testMsg));
                    console.log('[PLAN C] Sent test hello message:', testMsg);
                } catch (e) {
                    console.error('[PLAN C] Failed to send test message:', e);
                }
            }, 2000);
        });
        
        ws.addEventListener('error', (e) => {
            console.error('[PLAN C] WebSocket error:', e);
        });
        
        ws.addEventListener('message', (e) => {
            try {
                const data = JSON.parse(e.data);
                console.log('[PLAN C] WebSocket message received (parsed):', data);
            } catch (err) {
                console.log('[PLAN C] WebSocket message received (raw):', e.data);
            }
        });
        
        // Intercept send to see outgoing messages
        const originalSend = ws.send;
        ws.send = function(data) {
            try {
                const parsed = JSON.parse(data);
                console.log('[PLAN C] WebSocket sending (parsed):', parsed);
            } catch (err) {
                console.log('[PLAN C] WebSocket sending (raw):', data);
            }
            return originalSend.call(this, data);
        };
        
        return ws;
    };
    
    console.log('[PLAN C] WebSocket interceptor installed');
    
    // Add debugging for when WebSocket constructor is called
    console.log('[PLAN C] Waiting for WebSocket connections...');
    
    // Debug any clicks on the page
    document.addEventListener('click', (e) => {
        console.log('[PLAN C] Click detected on:', e.target.tagName, e.target.textContent);
    });
})();
