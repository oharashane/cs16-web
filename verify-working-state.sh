#!/bin/bash

# CS1.6 WebRTC Working State Verification Script
# This script ensures the ArrayBuffer fix is properly applied

echo "🔍 CS1.6 WebRTC - Working State Verification"
echo "============================================="

ERRORS=0

# 1. Check Docker volume mount
echo "1. Checking Docker volume mount..."
if grep -q "./go-webrtc-server/client:/app/client:ro" web-server/docker-compose.yml; then
    echo "   ✅ Volume mount exists"
else
    echo "   ❌ Volume mount MISSING - files won't update in container!"
    ERRORS=$((ERRORS + 1))
fi

# 2. Check JavaScript memory patch
echo "2. Checking JavaScript memory patch..."
MEMORY_VALUE=$(grep -o "INITIAL_MEMORY||[0-9]*" web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js | cut -d'|' -f3)
if [ "$MEMORY_VALUE" = "536870912" ]; then
    echo "   ✅ Memory set to 512MB (536870912 bytes)"
else
    echo "   ❌ Memory is $MEMORY_VALUE, should be 536870912 (512MB)"
    echo "   Run: sed -i 's/INITIAL_MEMORY||134217728/INITIAL_MEMORY||536870912/g' web-server/go-webrtc-server/client/assets/main-CqZe0kYo.js"
    ERRORS=$((ERRORS + 1))
fi

# 3. Check ReUnion config
echo "3. Checking ReUnion config..."
if [ -f "cs-server/reunion.cfg" ]; then
    if grep -q "SteamIdHashSalt" cs-server/reunion.cfg; then
        echo "   ✅ ReUnion config exists with SteamIdHashSalt"
    else
        echo "   ⚠️  ReUnion config exists but missing SteamIdHashSalt"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "   ❌ ReUnion config MISSING"
    ERRORS=$((ERRORS + 1))
fi

# 4. Check for test message (volume mount verification)
echo "4. Checking test message..."
if grep -q "🧪 TEST: Volume mount working" web-server/go-webrtc-server/client/index.html; then
    echo "   ✅ Test message exists for volume mount verification"
else
    echo "   ⚠️  Test message missing (optional)"
fi

# 5. Check network mode
echo "5. Checking network mode..."
if grep -q "network_mode.*host" web-server/docker-compose.yml; then
    echo "   ✅ Network mode: host"
else
    echo "   ⚠️  Network mode not set to host"
fi

echo ""
echo "============================================="
if [ $ERRORS -eq 0 ]; then
    echo "🎉 ALL CHECKS PASSED - ArrayBuffer fix properly applied!"
    echo ""
    echo "Ready to test: http://localhost:8080/client?connect=127.0.0.1:27015"
else
    echo "❌ $ERRORS ISSUE(S) FOUND - Fix before testing!"
fi
echo "============================================="

exit $ERRORS
