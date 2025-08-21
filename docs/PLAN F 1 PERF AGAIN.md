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

## 🚀 CRITICAL UPDATE: ChatGPT's Comprehensive Solution

### The Real Problem
The current TURBO implementation has a fundamental issue: **the Emscripten/engine code is (re)creating and (re)sizing "its" canvas after our code runs, so our CSS/backing-store changes get blown away.**

### Why Previous Attempts Failed
- **Engine overrides**: The webxash/Emscripten runtime often writes `canvas.width/height` when it enters fullscreen or on any "video mode" change
- **Simple assignments**: `canvas.width = ...` from our code gets immediately clobbered
- **Timing issues**: Engine initialization happens after our canvas setup

### ChatGPT's Robust Solution: Property Traps & Engine Hooks

#### **Three Critical Hook Points:**
1. **Before engine loads** (supply Module + a canvas)
2. **When engine asks for WebGL context** (override attributes)
3. **Whenever engine writes canvas.width/height** (trap and scale it)

#### **Drop-in Shim Implementation**
```javascript
(() => {
  // --- Config via cookies (adapted from ChatGPT's URL params) ---
  function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for(let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }
  
  const SCALE   = Math.max(0.25, Math.min(1, parseFloat(getCookie('turbo_scale') || '0.75')));
  const MAXDPR  = parseFloat(getCookie('turbo_maxdpr') || '1');

  // Effective DPR clamp (Chrome lets us override; Safari may ignore)
  const realDPR = window.devicePixelRatio || 1;
  const clampedDPR = (MAXDPR > 0 ? Math.min(realDPR, MAXDPR) : realDPR);
  const effectiveScale = clampedDPR * SCALE;

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      get: () => clampedDPR,
      configurable: true
    });
  } catch { /* readonly in some browsers; harmless */ }

  // Ensure we own a canvas up front so Emscripten uses it
  function ensureCanvas() {
    let c = document.getElementById('canvas') || document.querySelector('canvas');
    if (!c) {
      c = document.createElement('canvas');
      c.id = 'canvas';
      Object.assign(c.style, {
        width: '100vw', height: '100vh', display: 'block',
        imageRendering: 'pixelated' // comment out if you want smoother upscale
      });
      document.body.appendChild(c);
    }
    return c;
  }

  // Trap width/height assignments and scale the backing store
  function installSizeTraps(canvas) {
    const proto = HTMLCanvasElement.prototype;
    const wDesc = Object.getOwnPropertyDescriptor(proto, 'width');
    const hDesc = Object.getOwnPropertyDescriptor(proto, 'height');
    if (!wDesc || !hDesc) return;

    const toScaled = (v) => Math.max(1, Math.floor(v * effectiveScale));

    Object.defineProperty(canvas, 'width', {
      get() { return wDesc.get.call(this); },
      set(v) {
        // Keep CSS size unscaled; only backing store is reduced
        if (!this.style.width) this.style.width = v + 'px';
        wDesc.set.call(this, toScaled(v));
      },
      configurable: true
    });

    Object.defineProperty(canvas, 'height', {
      get() { return hDesc.get.call(this); },
      set(v) {
        if (!this.style.height) this.style.height = v + 'px';
        hDesc.set.call(this, toScaled(v));
      },
      configurable: true
    });
  }

  // Force desired WebGL attributes and avoid AA on weak GPUs
  function patchGetContext(canvas) {
    const orig = canvas.getContext.bind(canvas);
    canvas.getContext = function(type, attrs) {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
        attrs = Object.assign({
          antialias: false,
          alpha: false,
          depth: true,
          stencil: false,
          preserveDrawingBuffer: false,
          desynchronized: true,
          powerPreference: 'high-performance'
        }, attrs || {});
      }
      return orig(type, attrs);
    };
  }

  // Reapply traps if the engine swaps/renames the canvas
  const mo = new MutationObserver(() => {
    const c = document.getElementById('canvas') || document.querySelector('canvas');
    if (c && !c.__scaledInstalled) {
      installSizeTraps(c);
      patchGetContext(c);
      c.__scaledInstalled = true;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    const c = ensureCanvas();
    installSizeTraps(c);
    patchGetContext(c);
    c.__scaledInstalled = true;
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  });

  // Provide Module early so Emscripten picks up our canvas and GL prefs
  window.Module = window.Module || {};
  Module.canvas = (() => {
    // If DOM not ready yet, lazily resolve at first access
    let cached = null;
    return new Proxy({}, {
      get(_, prop) {
        if (!cached) {
          cached = document.getElementById('canvas') || ensureCanvas();
          installSizeTraps(cached);
          patchGetContext(cached);
          cached.__scaledInstalled = true;
        }
        return cached[prop].bind ? cached[prop].bind(cached) : cached[prop];
      },
      set(_, prop, val) {
        const c = document.getElementById('canvas') || ensureCanvas();
        c[prop] = val;
        return true;
      }
    });
  })();

  Module.webglContextAttributes = Object.assign(
    {
      antialias: false,
      alpha: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    },
    Module.webglContextAttributes || {}
  );

  // If Emscripten exposes setCanvasSize/Browser.resizeCanvas, wrap them to enforce scaling
  Module.preRun = Module.preRun || [];
  Module.preRun.push(function () {
    // Late trap for Emscripten helpers if present
    const tryWrap = () => {
      if (Module.setCanvasSize && !Module.__scaledSetCanvasSizeWrapped) {
        const orig = Module.setCanvasSize;
        Module.setCanvasSize = function (w, h, noUpdates) {
          return orig.call(this, Math.floor(w), Math.floor(h), noUpdates);
        };
        Module.__scaledSetCanvasSizeWrapped = true;
      }
      if (window.Browser && Browser.resizeCanvas && !Browser.__scaledResizeWrapped) {
        const origR = Browser.resizeCanvas;
        Browser.resizeCanvas = function (w, h) {
          // Keep CSS size (w,h) but backing store scaled by traps
          const c = (Module.canvas && Module.canvas.nodeType) ? Module.canvas : document.getElementById('canvas');
          if (c) {
            c.style.width  = w + 'px';
            c.style.height = h + 'px';
            // Setting width/height triggers our property traps → scaled backing store
            c.width  = w;
            c.height = h;
          }
          return origR.call(this, w, h);
        };
        Browser.__scaledResizeWrapped = true;
      }
    };
    tryWrap();
    setTimeout(tryWrap, 0); // in case those symbols appear slightly later
  });
})();
```

### Why This Solution Works

#### **Property Traps**
- By redefining the setters for `width/height` on the specific canvas instance, every engine write is intercepted and scaled
- Keep the CSS size at the engine's requested value, but the backing store is reduced by `effectiveScale` (DPR clamp × scale)

#### **Context Patch**
- If the engine requests AA or other expensive flags, we override them to stop Intel/Radeon iGPUs from tanking

#### **DPR Clamp**
- Many engines multiply by `devicePixelRatio` internally
- Overriding it (where allowed) prevents the engine from silently "undoing" your downscale on Retina

#### **Engine Integration**
- **Module.canvas**: Proxy that ensures our canvas is used
- **MutationObserver**: Reapplies traps if engine swaps/renames canvas
- **preRun hooks**: Wraps Emscripten's resize functions

### Testing & Debugging

#### **Verify Engine Canvas Interaction**
```javascript
const c = document.getElementById('canvas');
['width','height'].forEach(k => {
  const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, k);
  Object.defineProperty(c, k, {
    set(v){ console.log('engine set', k, v); d.set.call(this, v); },
    get(){ return d.get.call(this); }, configurable:true
  });
});
```

#### **Recommended Settings**
- **`maxdpr=1`**: Biggest win on Retina iMacs
- **`maxdpr=1&scale=0.75`**: Balanced performance
- **`maxdpr=1&scale=0.5`**: Maximum performance

#### **Dual-GPU Mac Fallback**
```javascript
Module.webglContextAttributes.powerPreference = 'low-power';
// Sometimes routes to iGPU in dual-GPU Macs more predictably
```

### Fallback: Pure CSS Transform
If the traps don't work, use visual scaling only:
```javascript
const c = document.getElementById('canvas');
const factor = 0.5; // 50% render size, 2x visual scale
c.style.transformOrigin = 'top left';
c.style.transform = `scale(${1/factor})`;
c.style.width = `${Math.floor(window.innerWidth*factor)}px`;
c.style.height = `${Math.floor(window.innerHeight*factor)}px`;
c.width  = Math.floor(window.innerWidth*factor);
c.height = Math.floor(window.innerHeight*factor);
```

### Implementation Priority
1. **Replace current turbo.html** with ChatGPT's shim approach
2. **Test on Retina displays** to verify engine canvas interaction
3. **Implement cookie-based config** (already done in turboconfig.html)
4. **Add debugging tools** to monitor canvas size changes
5. **Performance validation** on target devices

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
- [x] Add turboconfig.html configuration page
- [x] Fix parameter handling and favicon

### Phase 2: Integration & Testing
- [x] Integrate with server connection logic
- [x] Cookie-based settings persistence
- [x] Dashboard configuration link
- [ ] **CRITICAL**: Implement ChatGPT's property trap solution
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
