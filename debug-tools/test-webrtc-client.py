#!/usr/bin/env python3
"""
WebRTC ICE Candidate Test Client
Tests if the WebRTC server is properly configured with host IP instead of Docker bridge IP
"""

import asyncio
import json
import websockets
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def test_webrtc_ice():
    """Test WebRTC ICE candidates"""
    
    logger.info("🧪 Starting WebRTC ICE candidate test")
    logger.info("Connecting to WebSocket at ws://localhost:8080/websocket...")
    
    try:
        async with websockets.connect('ws://localhost:8080/websocket') as websocket:
            logger.info("✅ WebSocket connected successfully")
            
            # Listen for messages from server
            ice_candidates_received = 0
            docker_bridge_detected = False
            proper_ip_detected = False
            
            async for message in websocket:
                try:
                    data = json.loads(message)
                    event = data.get('event', '')
                    
                    logger.info(f"📨 Received event: {event}")
                    
                    if event == 'offer':
                        logger.info("🎯 Received WebRTC offer from server")
                        # For this test, we just want to see the offer and any ICE candidates
                        # We'll send a dummy answer to keep the connection alive
                        
                        dummy_answer = {
                            "event": "answer",
                            "data": {
                                "type": "answer",
                                "sdp": "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE\r\nm=application 0 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:test\r\na=ice-pwd:test\r\na=setup:active\r\na=mid:\r\na=sctp-port:5000\r\n"
                            }
                        }
                        await websocket.send(json.dumps(dummy_answer))
                        logger.info("📤 Sent dummy answer")
                        
                    elif event == 'candidate':
                        ice_candidates_received += 1
                        candidate = data.get('data', {}).get('candidate', '')
                        
                        logger.info(f"🧊 ICE Candidate #{ice_candidates_received}: {candidate}")
                        
                        # Check for Docker bridge IP (172.x.x.x)
                        if '172.' in candidate:
                            logger.warning("⚠️  DOCKER BRIDGE IP DETECTED!")
                            logger.warning(f"   Candidate: {candidate}")
                            docker_bridge_detected = True
                        else:
                            logger.info("✅ Candidate uses proper IP")
                            proper_ip_detected = True
                        
                        # Stop after receiving a few candidates
                        if ice_candidates_received >= 3:
                            break
                            
                except json.JSONDecodeError:
                    logger.error(f"❌ Failed to parse message: {message}")
                except Exception as e:
                    logger.error(f"❌ Error processing message: {e}")
    
    except Exception as e:
        logger.error(f"❌ Connection failed: {e}")
        return
    
    # Summary
    logger.info("\n" + "="*50)
    logger.info("🏁 TEST SUMMARY")
    logger.info("="*50)
    logger.info(f"ICE Candidates received: {ice_candidates_received}")
    logger.info(f"Docker bridge IP detected: {'YES ⚠️' if docker_bridge_detected else 'NO ✅'}")
    logger.info(f"Proper IP detected: {'YES ✅' if proper_ip_detected else 'NO ⚠️'}")
    
    if not docker_bridge_detected and proper_ip_detected:
        logger.info("🎉 SUCCESS: WebRTC ICE candidates are properly configured!")
    elif docker_bridge_detected:
        logger.error("❌ ISSUE: Docker bridge IPs detected in ICE candidates")
        logger.error("   This will prevent browser WebRTC connections from working")
        logger.error("   Solution: Ensure IP environment variable is set correctly")
    else:
        logger.warning("⚠️  INCOMPLETE: No clear results - may need more testing")

if __name__ == "__main__":
    asyncio.run(test_webrtc_ice())