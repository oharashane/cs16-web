# PLAN C - Yohimik Xash3D WebRTC Research

## 🎯 MISSION ACCOMPLISHED!

Successfully captured the **complete working WebRTC signaling protocol** from the original yohimik xash3d container.

### ✅ Setup Details

- **Container**: `yohimik/cs-web-server:0.0.0-i386`
- **Web Client**: `http://localhost:27016` 
- **Game Server**: `UDP localhost:27017` (Xash3D FWGS)
- **Valve.zip**: Properly mounted with CS 1.6 game files
- **Status**: ✅ **FULLY WORKING** - Client connects, WebRTC established, game initializes

### 🔍 Browser Console Output

```
main-CqZe0kYo.js:13 Error: Could not load dynamic lib: /rwdir/filesystem_stdio.so
main-CqZe0kYo.js:13 Error: /assets/filesystem_stdio-CVu1CW7S.wasm: file not found, and synchronous loading of external files is not available
main-CqZe0kYo.js:19 WebGL: INVALID_ENUM: getParameter: invalid parameter name
main-CqZe0kYo.js:26 [Deprecation] The ScriptProcessorNode is deprecated. Use AudioWorkletNode instead. (https://bit.ly/audio-worklet)
[Violation] 'requestAnimationFrame' handler took <N>ms (multiple times)
main-CqZe0kYo.js:13 [13:14:38] FS_AddGameHierarchy( valve )
main-CqZe0kYo.js:13 [13:14:38] Adding directory: /rodir/valve/
main-CqZe0kYo.js:13 [13:14:38] Adding directory: valve/
main-CqZe0kYo.js:13 [13:14:38] FS_AddGameHierarchy( cstrike )
main-CqZe0kYo.js:13 [13:14:38] Adding directory: /rodir/cstrike/
main-CqZe0kYo.js:13 [13:14:38] Adding directory: cstrike/downloaded/
main-CqZe0kYo.js:13 [13:14:38] Adding directory: cstrike/
main-CqZe0kYo.js:13 [13:14:38] Adding directory: cstrike/custom/
main-CqZe0kYo.js:13 [13:14:39] Setting up renderer...
main-CqZe0kYo.js:13 [13:14:40] Note: VoiceCapture_Init: capture device creation success (3: (null))
main-CqZe0kYo.js:13 [13:14:46] Scoring will not start until both teams have players
```

**Key Observations:**
- ✅ Game engine initializes completely
- ✅ File system hierarchy loads properly  
- ✅ Renderer and voice capture work
- ✅ Game server is ready ("Scoring will not start until both teams have players")

### 🎯 **CRITICAL DISCOVERY: WebRTC Signaling Protocol**

## 📨 Complete Message Format

The yohimik WebRTC protocol uses this **exact format**:

```json
{
  "event": "EVENT_TYPE",
  "data": {
    // Standard WebRTC data (SDP, ICE candidates, etc.)
  }
}
```

### 🔄 Message Types Observed

#### 1. **Offer Messages**
```json
{
  "event": "offer",
  "data": {
    "type": "offer",
    "sdp": "v=0\r\no=- 4155100219876785928 1754939660 IN IP4 0.0.0.0\r\n..."
  }
}
```

#### 2. **Answer Messages**  
```json
{
  "event": "answer",
  "data": {
    "type": "answer", 
    "sdp": "v=0\r\no=- 972719125533431989 2 IN IP4 127.0.0.1\r\n..."
  }
}
```

#### 3. **ICE Candidate Messages**
```json
{
  "event": "candidate",
  "data": {
    "candidate": "candidate:1246664587 1 udp 2130706431 172.17.0.2 43199 typ host ufrag MyCHbOuaDFjCBWUr",
    "sdpMid": "0",
    "sdpMLineIndex": 0,
    "usernameFragment": null
  }
}
```

### 🔥 **Complete Captured WebSocket Traffic**

```
{"event":"offer","data":{"type":"offer","sdp":"v=0\r\no=- 4155100219876785928 1754939660 IN IP4 0.0.0.0\r\ns=-\r\nt=0 0\r\na=msid-semantic:WMS *\r\na=fingerprint:sha-256 C6:D0:A8:C8:B8:49:9A:AD:81:C3:5B:79:FE:6A:32:9F:09:7C:DD:5A:17:4F:40:32:F3:7D:91:3E:DE:34:4E:AD\r\na=extmap-allow-mixed\r\na=group:BUNDLE 0 1\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 9 0 8\r\nc=IN IP4 0.0.0.0\r\na=setup:actpass\r\na=mid:0\r\na=ice-ufrag:MyCHbOuaDFjCBWUr\r\na=ice-pwd:qBhEttlHAcjrIPMxIWENqlsoBitmytUs\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtcp-fb:111 transport-cc \r\na=rtpmap:9 G722/8000\r\na=rtcp-fb:9 transport-cc \r\na=rtpmap:0 PCMU/8000\r\na=rtcp-fb:0 transport-cc \r\na=rtpmap:8 PCMA/8000\r\na=rtcp-fb:8 transport-cc \r\na=extmap:4 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=recvonly\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=setup:actpass\r\na=mid:1\r\na=sendrecv\r\na=sctp-port:5000\r\na=max-message-size:1073741823\r\na=ice-ufrag:MyCHbOuaDFjCBWUr\r\na=ice-pwd:qBhEttlHAcjrIPMxIWENqlsoBitmytUs\r\n"}}

{"event":"candidate","data":{"candidate":"candidate:1246664587 1 udp 2130706431 172.17.0.2 43199 typ host ufrag MyCHbOuaDFjCBWUr","sdpMid":"0","sdpMLineIndex":0,"usernameFragment":null}}

{"event":"answer","data":{"sdp":"v=0\r\no=- 972719125533431989 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0 1\r\na=extmap-allow-mixed\r\na=msid-semantic: WMS\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 9 0 8\r\nc=IN IP4 0.0.0.0\r\na=rtcp:9 IN IP4 0.0.0.0\r\na=ice-ufrag:qU5T\r\na=ice-pwd:1XmXC8UEhDPYJzo2IMeMS8u3\r\na=ice-options:trickle\r\na=fingerprint:sha-256 4B:39:1E:FD:E5:5B:55:55:74:C0:87:B4:F7:DA:9E:03:25:5E:87:7B:92:91:78:36:48:FE:AF:79:71:57:29:30\r\na=setup:active\r\na=mid:0\r\na=extmap:4 http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01\r\na=inactive\r\na=rtcp-mux\r\na=rtcp-rsize\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:9 G722/8000\r\na=rtpmap:0 PCMU/8000\r\na=rtpmap:8 PCMA/8000\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:qU5T\r\na=ice-pwd:1XmXC8UEhDPYJzo2IMeMS8u3\r\na=ice-options:trickle\r\na=fingerprint:sha-256 4B:39:1E:FD:E5:5B:55:55:74:C0:87:B4:F7:DA:9E:03:25:5E:87:7B:92:91:78:36:48:FE:AF:79:71:57:29:30\r\na=setup:active\r\na=mid:1\r\na=sctp-port:5000\r\na=max-message-size:262144\r\n","type":"answer"}}

[Multiple rounds of offer/answer exchanges with ICE candidates...]
```

## 🧠 Key Protocol Insights

### 1. **Message Wrapper**
- **ALWAYS** uses `"event"` field (not `"type"`)
- **ALWAYS** wraps WebRTC data in `"data"` field
- Standard WebRTC SDP/ICE data is nested inside

### 2. **Event Types**
- `"offer"` - Client sends WebRTC offer
- `"answer"` - Server responds with WebRTC answer  
- `"candidate"` - ICE candidate exchange (bidirectional)

### 3. **Key Differences from Standard WebRTC**
- ❌ **NOT**: `{"type": "offer", "sdp": "..."}`
- ✅ **YES**: `{"event": "offer", "data": {"type": "offer", "sdp": "..."}}`

### 4. **Handshake Flow**
1. Client connects to WebSocket
2. **NO GREETING REQUIRED** - Client immediately starts sending offers
3. Multiple offer/answer rounds with ICE candidate exchanges
4. WebRTC connection established
5. Game data flows over DataChannel

## 🔧 **Implementation Requirements for Our Relay**

### Message Format Changes Required:

#### Current (Standard WebRTC):
```python
await ws.send_text(json.dumps({"type": "ready"}))
offer = await ws.receive_text()
# Expects: {"type": "offer", "sdp": "..."}
```

#### Required (Yohimik Format):
```python
# NO initial greeting needed!
offer = await ws.receive_text()  
# Expects: {"event": "offer", "data": {"type": "offer", "sdp": "..."}}

# Extract the actual WebRTC data:
offer_data = json.loads(offer)
if offer_data.get("event") == "offer":
    webrtc_offer = offer_data["data"]  # This contains the real SDP
    
# Send answer in yohimik format:
answer_response = {
    "event": "answer",
    "data": {
        "type": "answer", 
        "sdp": answer_sdp
    }
}
await ws.send_text(json.dumps(answer_response))
```

## 🎯 **Next Steps**

1. ✅ **COMPLETE**: Captured working protocol  
2. 🔄 **IN PROGRESS**: Update our relay to use exact yohimik message format
3. ⏳ **PENDING**: Test yohimik client with updated relay
4. ⏳ **PENDING**: Bridge DataChannel traffic to ReHLDS server

## 📊 **Success Metrics**

- ✅ **Working yohimik container**: Full web client + WebRTC + game server
- ✅ **Complete protocol capture**: All message types and formats documented
- ✅ **Engine initialization**: Game loads completely and is ready for players
- ✅ **WebRTC establishment**: Multiple offer/answer rounds successful

## 🏆 **Impact**

This research provides the **exact blueprint** needed to make our aiortc relay compatible with yohimik's client. We now know the precise message format differences and can implement them directly.

**BREAKTHROUGH STATUS: 🎉 COMPLETE!**
