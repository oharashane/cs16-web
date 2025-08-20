# PLAN F 1: Performance Optimization for Retina Displays

## Overview
This plan implements performance optimizations specifically for Retina displays and high-DPI monitors where the WebAssembly CS1.6 client may struggle with performance. The solution involves creating a "TURBO" mode that reduces rendering resolution while maintaining the visual canvas size.

## Problem Statement
- **Retina displays** (iMacs, MacBooks) have high device pixel ratios that can cause performance issues
- **4K monitors** may struggle with full-resolution WebGL rendering
- **Intel GPUs** on Macs can be particularly sensitive to high-resolution WebGL operations
- The current client renders at full native resolution, which can be too demanding

## Solution: Resolution Scaling with Canvas Size Preservation
The approach is to:
1. **Keep canvas CSS size** (what the user sees) at full screen
2. **Reduce backing store size** (what WebGL actually renders) by applying a scale factor
3. **Let the browser upscale** the low-res frame to fit the CSS size
4. **Provide pixel-perfect scaling** with nearest-neighbor interpolation

## Implementation Strategy

### 1. Create Turbo Client (`turbo.html`)
- **New file**: `web-server/go-webrtc-server/client/turbo.html`
- **Based on**: ChatGPT's optimized HTML template
- **Features**: 
  - URL parameter support (`?scale=0.5&maxdpr=1`)
  - Automatic Retina detection and scaling
  - WebGL context optimization for Macs
  - Canvas size management

### 2. Dashboard Integration
- **Add TURBO toggle** to the dashboard
- **Modify server connection** to open turbo client when TURBO is enabled
- **Preserve original client** as default option

### 3. URL Parameter Support
- **`scale`**: Render resolution multiplier (0.25 to 1.0)
- **`maxdpr`**: Maximum device pixel ratio (0 = no limit, 1 = clamp to 1x)

## Technical Implementation

### Canvas Management
```javascript
// CSS size (keeps the visual size)
canvas.style.width = cssW + 'px';
canvas.style.height = cssH + 'px';

// Backing store size (controls render resolution)
const dpr = effectiveDpr();
const w = Math.max(1, Math.floor(cssW * dpr));
const h = Math.max(1, Math.floor(cssH * dpr));
canvas.width = w;
canvas.height = h;
```

### WebGL Context Optimization
```javascript
Module.webglContextAttributes = {
    antialias: false,           // Disable antialiasing for performance
    alpha: false,               // Disable alpha channel
    depth: true,                // Keep depth buffer
    stencil: false,             // Disable stencil buffer
    desynchronized: true,       // Async rendering
    powerPreference: 'high-performance', // Prefer dedicated GPU
    preserveDrawingBuffer: false // Don't preserve buffer
};
```

### CSS Pixel Scaling
```css
#game { 
    image-rendering: pixelated; 
    image-rendering: crisp-edges; 
}
```

## Usage Patterns

### Half-Resolution on Retina
```
turbo.html?scale=0.5
```
- Renders at 50% of native resolution
- Maintains full visual size
- Significant performance improvement

### Clamp Retina to 1x
```
turbo.html?maxdpr=1
```
- Forces 1x device pixel ratio
- No HiDPI scaling
- Good for older Intel GPUs

### Combined Optimization
```
turbo.html?maxdpr=1&scale=0.75
```
- Clamps DPR to 1x
- Renders at 75% resolution
- Maximum performance gain on iMacs

## File Structure Changes

```
web-server/go-webrtc-server/client/
├── index.html          # Original client (unchanged)
├── turbo.html          # New turbo client
└── assets/             # Shared assets
```

## Dashboard Changes

### TURBO Toggle
- **Location**: Above server list in Game Servers card
- **Style**: Prominent button with turbo icon
- **State**: Toggle between "NORMAL" and "TURBO" modes
- **Persistence**: Remember user preference

### Server Connection Logic
```javascript
// When TURBO is enabled
if (turboMode) {
    const clientUrl = `/client/turbo.html?server=${serverInfo.port}`;
} else {
    const clientUrl = `/client?server=${serverInfo.port}`;
}
```

## Performance Benefits

### Expected Improvements
- **Retina displays**: 2-4x performance improvement
- **4K monitors**: 3-5x performance improvement  
- **Intel GPUs**: Significant reduction in GPU bottleneck
- **Battery life**: Lower power consumption on laptops

### Quality Trade-offs
- **Visual clarity**: Slightly reduced at lower scales
- **Text readability**: May be affected at very low scales
- **Pixel art**: Actually improved with nearest-neighbor scaling

## Testing Strategy

### Performance Metrics
- **FPS measurement** before/after optimization
- **GPU utilization** monitoring
- **Memory usage** tracking
- **Battery impact** on laptops

### Target Devices
- **iMac (Retina)**: Primary target
- **MacBook Pro**: Secondary target
- **4K Windows**: Validation target
- **Standard displays**: Ensure no regression

## Future Enhancements

### Adaptive Scaling
- **Auto-detect** device capabilities
- **Dynamic adjustment** based on performance
- **User preference** learning

### Quality Presets
- **Ultra Performance**: scale=0.5, maxdpr=1
- **Balanced**: scale=0.75, maxdpr=1
- **Quality**: scale=1.0, maxdpr=1
- **Native**: scale=1.0, maxdpr=0

### Advanced WebGL Features
- **Texture filtering** optimization
- **Shader compilation** caching
- **Frame buffer** management

## Implementation Notes

### Emscripten Compatibility
- **Canvas ID**: Use `#game` to match existing client
- **Module.canvas**: Point to our canvas before main.js loads
- **Size changes**: Handle engine resize events

### Browser Compatibility
- **Chrome/Safari**: Full support
- **Firefox**: Full support  
- **Edge**: Full support
- **Mobile**: Responsive scaling

### Fallback Strategy
- **Graceful degradation** if turbo mode fails
- **Automatic fallback** to normal client
- **User notification** of any issues

## Success Criteria

### Performance Targets
- **Retina displays**: Minimum 30 FPS at scale=0.5
- **4K monitors**: Minimum 45 FPS at scale=0.75
- **Standard displays**: No performance regression

### User Experience
- **Seamless switching** between normal and turbo modes
- **Clear visual feedback** of current mode
- **Intuitive controls** for performance vs quality trade-offs

### Technical Quality
- **No breaking changes** to existing functionality
- **Clean separation** of concerns
- **Maintainable code** structure

## Timeline

### Phase 1: Core Implementation
- [x] Create PLAN F documentation
- [x] Implement turbo.html client
- [x] Add dashboard TURBO toggle
- [x] Test basic functionality

### Phase 2: Integration & Testing
- [ ] Integrate with server connection logic
- [ ] Performance testing on target devices
- [ ] User experience validation
- [ ] Bug fixes and optimization

### Phase 3: Enhancement & Polish
- [ ] Advanced scaling options
- [ ] Performance monitoring
- [ ] User preference learning
- [ ] Documentation updates

## References

### ChatGPT Performance Suggestions
- **Resolution scaling** approach
- **Canvas size preservation** technique
- **WebGL context optimization** for Macs
- **URL parameter** implementation

### Technical Resources
- **WebGL best practices** for performance
- **Canvas scaling** techniques
- **Device pixel ratio** management
- **Emscripten canvas** integration

---

*This plan addresses the specific performance challenges faced by Retina displays and high-DPI monitors while maintaining the existing client functionality and user experience.*
