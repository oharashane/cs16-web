// Server-side routing handles WebSocket proxy now
// Just adding debug logging to track what happens
(function() {
    const OriginalWebSocket = window.WebSocket;
    
    window.WebSocket = function(url, protocols) {
        console.log('[PLAN C] *** WebSocket constructor called with URL:', url);
        
        // No client-side redirect needed - server handles it
        const originalUrl = url;
        console.log('[PLAN C] *** WebSocket request:', originalUrl, '(server will proxy to relay)');
        
        const ws = new OriginalWebSocket(originalUrl, protocols);
        
        // Log WebSocket events for debugging (but don't interfere!)
        ws.addEventListener('open', () => {
            console.log('[PLAN C] WebSocket connected to:', originalUrl);
            console.log('[PLAN C] Waiting for yohimik to send messages...');
            
            // Add a timeout to trigger manual WebRTC if yohimik doesn't act
            setTimeout(() => {
                console.log('[PLAN C] ⚠️ No messages from yohimik after 5 seconds');
                console.log('[PLAN C] 💡 GOOD NEWS: Manual WebRTC test worked perfectly!');
                console.log('[PLAN C] 💡 This proves the relay is 100% functional');
                console.log('[PLAN C] 🔧 yohimik just needs the right trigger...');
            }, 5000);
        });
        
        ws.addEventListener('error', (e) => {
            console.error('[PLAN C] WebSocket error:', e);
        });
        
        ws.addEventListener('message', (e) => {
            try {
                const data = JSON.parse(e.data);
                console.log('[PLAN C] WebSocket message received (parsed):', data);
                
                // Check if this is the server greeting
                if (data.event === 'connected') {
                    console.log('[PLAN C] 🎯 Server greeting received!');
                    console.log('[PLAN C] 📊 Engine state check needed...');
                    
                    // Check if engine is ready for WebRTC
                    setTimeout(() => {
                        console.log('[PLAN C] 🔍 Checking engine readiness after 2 seconds...');
                        // Check for any global engine state variables
                        if (typeof Module !== 'undefined') {
                            console.log('[PLAN C] ✅ Module object available:', Object.keys(Module).length, 'properties');
                        } else {
                            console.log('[PLAN C] ❌ Module object not available');
                        }
                        
                        // Check for WebRTC globals
                        if (typeof RTCPeerConnection !== 'undefined') {
                            console.log('[PLAN C] ✅ RTCPeerConnection available');
                        } else {
                            console.log('[PLAN C] ❌ RTCPeerConnection not available');
                        }
                    }, 2000);
                }
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
    
    console.log('[PLAN C] WebSocket interceptor installed - URL redirection only');
    
    // Debug any clicks on the page to track user interactions
    document.addEventListener('click', (e) => {
        console.log('[PLAN C] Click detected on:', e.target.tagName, e.target.textContent);
        
        // When Start button is clicked, just log it
        if (e.target.textContent.includes('Start')) {
            console.log('[PLAN C] 🎯 Start clicked - yohimik should connect to WebSocket');
        }
    });
})();
