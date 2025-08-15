MIT License

Copyright (c) 2025 yohimik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## Attribution

This project builds upon and includes components from:

- **yohimik's WebAssembly Counter-Strike 1.6 client**: MIT License
  - Source: https://github.com/yohimik/webxash3d-fwgs (examples/react-typescript-cs16-webrtc)
  - Components used: WebAssembly game client, WebRTC transport layer
  - Modifications: Memory management fixes, dynamic host detection, protocol bridging

- **ReHLDS (Reverse-Engineered Half-Life Dedicated Server)**: GPL License
  - Source: https://github.com/dreamstalker/rehlds
  - Used for: Counter-Strike 1.6 game server backend

- **AMX Mod X**: GPL License  
  - Source: https://github.com/alliedmodders/amxmodx
  - Used for: Server administration and game modifications

## Additional Credits

This project demonstrates browser-based Counter-Strike 1.6 gameplay by bridging WebRTC DataChannels to UDP game traffic, enabling web clients to connect to real ReHLDS servers alongside native Steam clients.

Special thanks to the yohimik project for pioneering WebAssembly-based Half-Life engine implementation and the open-source gaming community for maintaining classic game server technology.
