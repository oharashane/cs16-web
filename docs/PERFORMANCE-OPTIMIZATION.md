# Xash Client Performance Optimization Guide

This document contains various methods to improve Xash client performance on lower-end hardware like Intel iMacs with Retina displays.

## Performance Issues
- **Target**: Intel iMacs with Retina displays 
- **Problem**: Client "sputters" while running smoothly on high-end RTX 3090 systems
- **Root Cause**: High pixel density (Retina) requires rendering many more pixels

## Optimization Methods (Ordered by Reliability)

### 1. Engine Command Line Arguments ⭐⭐
**Currently Testing**: Pass resolution arguments to the Xash engine.

```html
<script>
  window.Module = {
    // ... other settings ...
    arguments: ['-w', '1024', '-h', '768', '+gl_vsync', '0'],
  };
</script>
```

### 2. Client Configuration (userconfig.cfg) ⭐⭐
**Game-Specific**: Add performance cvars to client config.

```
// === Performance Optimization ===
// Video settings
vid_fullscreen "0"
vid_width "1024"
vid_height "768"
cl_resolution "1024x768"

// Graphics quality
gl_vsync "0"                    // Avoid 30/15fps half-rate
r_detailtextures "0"           // Disable detail textures
gl_ansio "0"                   // Disable anisotropic filtering
gl_msaa "0"                    // Disable anti-aliasing
gl_texturemode "GL_LINEAR_MIPMAP_LINEAR"  // Basic texture filtering
r_decals "64"                  // Reduce decal count (default: 300)
cl_himodels "0"                // Use low-poly player models

// Additional performance tweaks
fps_max "60"                   // Cap framerate to reduce load
r_speeds "0"                   // Disable debug rendering
developer "0"                  // Disable developer mode
```

### 3. Memory Optimization ⭐
**Engine-Level**: Reduce memory allocation for better performance.

```javascript
window.Module = {
  INITIAL_MEMORY: 268435456,    // 256MB (reduced from 512MB)
  ALLOW_MEMORY_GROWTH: 0,       // Keep disabled for performance
};
```

## Testing Strategy

1. **Engine Arguments** - Direct engine resolution control
2. **Client Config** - Game-specific performance settings
3. **Memory Optimization** - Reduce memory footprint

## Performance Targets

- **iMac Target**: Smooth 30+ FPS gameplay
- **Resolution**: Testing 1024x768 vs native Retina

## Notes

- Engine arguments may not work on all Xash builds
- Client config changes require `valve.zip` update and server restart
- Test on actual iMac hardware for realistic results

## Methods Attempted & Results

### ❌ Canvas CSS Scaling (FAILED)
**Attempted**: JavaScript to reduce canvas render size while keeping CSS display size.
**Result**: Caused `setTimeout` violations and no performance improvement.
**Status**: Removed from codebase.

```javascript
// This FAILED - caused performance violations
const SCALE = 0.66;
c.width = Math.floor(cssW * SCALE);
c.height = Math.floor(cssH * SCALE);
```

### ❌ Memory Reduction (COUNTERPRODUCTIVE) 
**Attempted**: Reduced INITIAL_MEMORY from 512MB to 256MB.
**Result**: User reported this would hurt performance, not help it.
**Status**: Reverted back to 512MB.

### 🔄 Engine Command Line Arguments (TESTING)
**Attempted**: Pass resolution arguments directly to Xash engine.
**Current**: `-w 800 -h 600 +gl_vsync 0 +fps_max 60`
**Result**: Code runs (confirmed via console logs) but no visible performance improvement.
**Status**: ⚠️ May be ignored by engine or not working as expected.

### ✅ Client Configuration CVars (ACTIVE)
**Attempted**: Aggressive performance settings in `userconfig.cfg`.
**Status**: Applied and active via `valve.zip`.

## Implementation Status

- [❌] **Canvas scaling** - Failed, caused performance issues
- [❌] **Memory reduction** - Counterproductive, reverted
- [🔄] **Engine arguments** - Code executes but no visible effect
- [✅] **Client config optimization** - Applied via userconfig.cfg
- [🔄] **Performance validation on iMac** - Still testing

## Current Active Configuration

### Engine Arguments (Status: Unknown effectiveness)
- **Resolution**: 800x600 forced via `-w` and `-h` flags  
- **VSync**: Disabled via `+gl_vsync 0`
- **FPS Cap**: `+fps_max 60`
- **Location**: `/web-server/go-webrtc-server/client/index.html`
- **Confirmed**: Console logs show arguments are passed to Module

### Client Performance Config (Status: Active)
- **Location**: `/cs-client-config/userconfig.cfg` 
- **Aggressive Settings**: 
  - `r_decals "32"` - Minimal decals
  - `r_dynamic "0"` - Disable dynamic lighting
  - `vid_width/height` - Force lower resolution
  - `gl_texturemode "GL_LINEAR"` - Fastest filtering
  - Various other quality reductions

### Memory Settings (Status: Stable)
- **Memory**: 512MB (kept for stability)
- **Growth**: Disabled to prevent ArrayBuffer errors

## Additional Methods to Try (From ChatGPT)

### Browser-Level Optimizations
```javascript
// Force hardware acceleration
canvas.style.willChange = 'transform';
canvas.style.transform = 'translateZ(0)';

// Reduce pixel ratio
const devicePixelRatio = window.devicePixelRatio || 1;
const backingStoreRatio = /* ... WebGL context ratios ... */ || 1;
const ratio = Math.min(devicePixelRatio / backingStoreRatio, 2); // Cap at 2x
```

### Alternative Engine Arguments
```javascript
// Try different argument formats
arguments: ['-width', '800', '-height', '600', '-windowed', '+vid_d3d', '0']
arguments: ['+vid_mode', '800x600', '+gl_vsync', '0', '+fps_max', '60']
```

### WebGL Context Optimization
```javascript
// Request low-power GPU
canvas.getContext('webgl', { 
  powerPreference: 'low-power',
  antialias: false,
  depth: false 
});
```

## Testing Instructions

1. **Check console** - Look for `[DEBUG] CLIENT LOADED` and engine args
2. **Monitor performance** - Test on iMac for stuttering reduction  
3. **Verify arguments** - Check if engine actually uses passed arguments
4. **Test alternatives** - Try different argument formats if current ones fail
