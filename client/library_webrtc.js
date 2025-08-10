/**
 * library_webrtc.js - Emscripten library for WebRTC DataChannel integration
 * 
 * This file provides the JavaScript side of the WebRTC transport implementation.
 * It bridges between the C WebRTC transport and the browser's DataChannel API.
 */

var LibraryWebRTC = {
  // Check if WebRTC DataChannel is ready
  webrtc_init_js: function() {
    if (typeof Module !== 'undefined' && Module.__webrtc_dc) {
      console.log('[WebRTC Library] DataChannel is ready');
      return 1;
    }
    console.log('[WebRTC Library] DataChannel not ready');
    return 0;
  },

  // Send data over WebRTC DataChannel
  emscripten_webrtc_send: function(ptr, len) {
    try {
      if (!Module.__webrtc_dc) {
        console.error('[WebRTC Library] DataChannel not available for sending');
        return -1;
      }

      // Extract data from WebAssembly memory
      var data = HEAPU8.slice(ptr, ptr + len);
      
      console.log('[WebRTC Library] Sending', len, 'bytes via DataChannel');
      console.log('[WebRTC Library] Packet preview:', Array.from(data.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '));
      
      // Send via DataChannel
      Module.__webrtc_dc.send(data);
      
      return len; // Success
    } catch (e) {
      console.error('[WebRTC Library] Failed to send data:', e.message);
      return -1;
    }
  }
};

// Register the library with Emscripten
mergeInto(LibraryManager.library, LibraryWebRTC);
