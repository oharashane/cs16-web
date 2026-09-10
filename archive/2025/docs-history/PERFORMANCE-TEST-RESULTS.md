# Performance Optimization Test Results

**Problem**: Low FPS on older Intel iMacs with Retina displays (high resolution rendering struggles)
**Goal**: Reduce rendering load for high-DPI displays
**Date**: 2025-01-17

## ❌ **Approaches That Had NO Effect**

### 1. Module Configuration Approaches (ChatGPT Option A)
- **DPR Clamping**: `window.Browser.calculateDPR = () => 1`
- **Game Resolution Args**: `Module.arguments = ['-game','cstrike','-w','800','-h','600']`
- **Preinitialized WebGL Context**: `Module.preinitializedWebGLContext`
- **Result**: Zero visual or performance impact
- **Reason**: Pre-compiled yohimik client ignores Module settings entirely

### 2. Browser-Level Optimizations
- **CSS properties**: `imageRendering: pixelated`, `willChange`, `backfaceVisibility`
- **Hardware acceleration hints**: `transform: translateZ(0)`
- **Garbage collection optimization**
- **Result**: No noticeable performance improvement
- **Reason**: Bottleneck is not browser-level rendering

### 3. WebGL Context Optimization Only
- **High-performance context settings**: `powerPreference: 'high-performance'`
- **Disabled antialiasing, alpha, preserveDrawingBuffer**
- **Result**: No effect
- **Reason**: Engine creates its own context, ignores our settings

## ✅ **Approach That HAD Effect**

### Canvas Buffer Size Manipulation
- **Method**: Direct canvas.width/height modification after engine loads
- **Scale factors tested**: 50%, 80%, 85%
- **Result**: MAJOR visual effect (game rendered at lower resolution)
- **Problem**: Creates unplayable "zoomed into bottom-left corner" effect
- **Insight**: This proves rendering pipeline IS the bottleneck

## 🔍 **Key Insights**

1. **Pre-compiled yohimik engine ignores Module configuration** - Option A (shim) approach fundamentally won't work
2. **Canvas buffer scaling works BUT breaks display** - Engine expects buffer size = display size
3. **The bottleneck IS rendering** - Canvas manipulation had immediate effect
4. **High-DPI/Retina displays are the core issue** - Need proper DPR handling

## 🎯 **Next Steps**

### Option B Required: Source Modification
Since the pre-compiled client can't be configured via shims, we need:

1. **Find yohimik source code** for the client
2. **Implement ChatGPT Option B** (bake optimizations into main.ts)
3. **Rebuild the client** with proper DPR clamping and resolution handling

### Alternative Approaches
1. **Find different CS1.6 WebAssembly client** that supports configuration
2. **GPU-level solutions** (reduce display resolution at OS level)
3. **Hardware upgrade recommendations** for affected iMacs

## 📝 **Working Configuration to Preserve**

The baseline working client configuration (no performance mods):
- **Memory settings**: 512MB fixed, no growth (prevents ArrayBuffer issues)
- **Standard Module config**: Original yohimik settings
- **No canvas manipulation**: Engine manages canvas naturally

## 🗂️ **Files Created During Testing**
- `xash-shim.js` - Original aggressive approach
- `xash-shim-dpr-only.js` - DPR test
- `xash-shim-resolution-only.js` - Resolution test  
- `xash-shim-webgl-only.js` - WebGL test
- `xash-performance-final.js` - Refined canvas approach
- `xash-css-scaling.js` - CSS transform approach
- `xash-minimal-perf.js` - Browser optimization approach

All should be cleaned up and reverted to baseline.
