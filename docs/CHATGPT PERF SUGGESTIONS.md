

You don’t have to rebuild the engine to try my tweaks—you just need to stop loading their compiled module directly and insert a tiny shim module that sets the environment first, then imports their module. This works even if the compiled bundle is ESM and immediately runs on import.

Here are two clean paths:

Option A (no rebuild): add a tiny shim module
1) Change your HTML to load the shim instead of their bundle
<!-- Before (remove this line) -->
<!-- <script type="module" crossorigin src="/assets/main-CqZe0kYo.js"></script> -->

<!-- After: load our shim -->
<script type="module" src="/assets/xash-shim.js"></script>

2) Create /assets/xash-shim.js

This sets DPR→1, defines Module args, and (optionally) provides a smaller WebGL backbuffer before importing their module.

// /assets/xash-shim.js

// 1) Clamp DPR so Emscripten doesn't do Retina ×2 backbuffers
window.Browser = window.Browser || {};
window.Browser.calculateDPR = () => 1;

// 2) Prepare Module for the Emscripten runtime used by webxash
//    (These args are honored by yohimik's wrapper.)
window.Module = window.Module || {};
Module.arguments = ['-game','cstrike','-w','1024','-h','768']; // try 800x600 for more FPS

// 3) Optional: preinitialize a smaller WebGL context (guaranteed visible effect)
(function setupCanvas() {
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  const SCALE = 0.66; // 66% internal render → ~2.3× fewer pixels than 1× DPR

  const c = document.getElementById('canvas') || (() => {
    const el = document.createElement('canvas');
    el.id = 'canvas';
    document.body.prepend(el);
    return el;
  })();

  c.width  = Math.floor(cssW * SCALE);
  c.height = Math.floor(cssH * SCALE);
  c.style.width  = cssW + 'px';
  c.style.height = cssH + 'px';
  c.style.imageRendering = 'pixelated';

  // Provide preinitialized context so the engine adopts our size
  Module.preinitializedWebGLContext = c.getContext('webgl', {
    antialias: false, alpha: false, depth: true, stencil: false,
    preserveDrawingBuffer: false, powerPreference: 'high-performance'
  });
  Module.canvas = c;

  // Keep size locked on resize (Emscripten may try to reapply DPR)
  addEventListener('resize', () => {
    const W = window.innerWidth, H = window.innerHeight;
    c.width  = Math.floor(W * SCALE);
    c.height = Math.floor(H * SCALE);
    c.style.width  = W + 'px';
    c.style.height = H + 'px';
  });
})();

// 4) Finally, import their compiled module (the one you were loading directly)
import '/assets/main-CqZe0kYo.js';

That’s it. You’ve now injected the DPR clamp + render-size control before their bundle executes, without touching their code.

If you still see zero change, bump SCALE down to 0.5 so it’s unmistakable (HUD becomes visibly larger and FPS jumps). If it changes in Firefox but not Chrome on a specific Mac, that’s a browser quirk—stick with Firefox there.

Option B (tiny source tweak + rebuild): edit main.ts (safe & minimal)

If you’re willing to touch source, this is the smallest patch to yohimik’s main.ts (the file you linked). It bakes in the same logic in a straightforward way.

Patch gist (TypeScript):

// main.ts (near top, before constructing Xash3D)
;(window as any).Browser = (window as any).Browser || {};
(window as any).Browser.calculateDPR = () => 1; // clamp Retina

const canvas = document.getElementById('canvas') as HTMLCanvasElement ?? (() => {
  const el = document.createElement('canvas');
  el.id = 'canvas';
  document.body.prepend(el);
  return el;
})();

const cssW = window.innerWidth;
const cssH = window.innerHeight;
const SCALE = 0.66; // tune for FPS/clarity
canvas.width  = Math.floor(cssW * SCALE);
canvas.height = Math.floor(cssH * SCALE);
canvas.style.width  = cssW + 'px';
canvas.style.height = cssH + 'px';
canvas.style.imageRendering = 'pixelated';

const x = new Xash3D({
  canvas,
  module: {
    arguments: ['-game','cstrike','-w','1024','-h','768'],
    preinitializedWebGLContext: canvas.getContext('webgl', {
      antialias: false, alpha: false, depth: true, stencil: false,
      preserveDrawingBuffer: false, powerPreference: 'high-performance'
    }) as WebGLRenderingContext
  }
});

await x.init();
x.main();

// lock size on resize
addEventListener('resize', () => {
  const W = window.innerWidth, H = window.innerHeight;
  canvas.width  = Math.floor(W * SCALE);
  canvas.height = Math.floor(H * SCALE);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
});

This is a one-file change; rebuild the docker image the same way you did originally.

Which knobs actually matter for webxash3d-fwgs?

module.arguments → yes, supported; put -w/-h here (wrapper passes them through).

DPR clamp (Browser.calculateDPR) → very effective on Retina; prevents 2× backbuffers.

preinitializedWebGLContext → adopted by Emscripten; guarantees the internal render size you set on the canvas.

Post-init CVARs via Cmd_ExecuteString (e.g., gl_vsync 0, r_detailtextures 0) → nice-to-have; the visible change will come from DPR/backbuffer size.

Configs like cl_resolution aren’t standard in HL/Xash; use -w/-h or vid_width/vid_height if your build honors them. But if the engine ignores those, the canvas/backbuffer path above still wins because it doesn’t rely on engine CVARs at all.

