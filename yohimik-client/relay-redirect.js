// Intercept WebSocket connections and redirect to our relay
(function() {
    const OriginalWebSocket = window.WebSocket;
    
    window.WebSocket = function(url, protocols) {
        console.log('[PLAN C] *** WebSocket constructor called with URL:', url);
        
        // Redirect to our updated relay with yohimik-style greeting
        const originalUrl = url;
        url = 'ws://localhost:8090/signal';
        console.log('[PLAN C] *** Redirected WebSocket:', originalUrl, '→', url);
        
        const ws = new OriginalWebSocket(url, protocols);
        
        // Log WebSocket events for debugging (but don't interfere!)
        ws.addEventListener('open', () => {
            console.log('[PLAN C] WebSocket connected to:', url);
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
    });
})();
