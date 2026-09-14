package main

// Bring your own game, the first step: a page that reads a visitor's own Half-Life
// folder in their browser, hashes what it finds against the files the game needs
// (content/known-files.json, made from the base's source), and says what it found.
// Nothing leaves the browser: no upload, no copy. The step after this one writes the
// verified files into the same cache the base bundle uses, so that the museum serves
// only the free part and the Valve part comes from the visitor's own disk.

import "net/http"

func verifyPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write([]byte(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bring your own game</title>
<style>:root{color-scheme:dark}body{margin:0;padding:24px 16px;background:#141414;color:#e8e2cf;font:15px/1.5 system-ui,sans-serif;max-width:860px;margin-inline:auto}h1{font-size:1.4rem;margin:0 0 .3rem}p{margin:.4rem 0}.muted{opacity:.7}button{font:inherit;padding:.4rem 1rem;background:#262626;color:inherit;border:1px solid #3a352a;border-radius:8px;cursor:pointer}button:hover{border-color:#d9c37a}table{border-collapse:collapse;font-size:.9rem;margin-top:1rem}td,th{padding:.2rem .6rem;border-bottom:1px solid #2a2a2a;text-align:left}td.n{text-align:right;font-variant-numeric:tabular-nums}.ok{color:#8fd694}.bad{color:#e07a6a}progress{width:100%}</style></head><body>
<p class="muted"><a href="/" style="color:inherit">← the front door</a></p>
<h1>Bring your own game</h1>
<p>Point this page at your own <b>Half-Life</b> folder — the one Steam installed, with <code>valve/</code> and <code>cstrike/</code> inside — and it will read it here, in your browser, and check every file the game needs against the build the museum knows. <b>Nothing is uploaded.</b> The files stay on your disk; only their hashes are compared, and those are computed here too.</p>
<p><button id="pick">Choose the Half-Life folder</button> <span class="muted">Chrome and Edge open a folder picker; other browsers get a file chooser that can take a whole folder.</span></p>
<input id="files" type="file" webkitdirectory multiple hidden>
<progress id="bar" value="0" max="1" hidden></progress>
<p id="say" class="muted"></p>
<div id="out"></div>
<script>
const say = t => document.getElementById('say').textContent = t;
let known = null;
async function load() { known = (await (await fetch('/content/known-files.json')).json()).files; }
const bytesOf = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
async function sha256(file) { const buf = await file.arrayBuffer(); const h = await crypto.subtle.digest('SHA-256', buf); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join(''); }

// Walk the folder however the browser gave it: a directory handle, or a flat list with paths.
async function* walkHandle(dir, prefix) {
  for await (const [name, h] of dir.entries()) {
    if (h.kind === 'file') yield [prefix + name, await h.getFile()];
    else yield* walkHandle(h, prefix + name + '/');
  }
}
function* walkList(list) {
  for (const f of list) { const rel = (f.webkitRelativePath || f.name).split('/').slice(1).join('/'); yield [rel, f]; }
}

async function check(entries) {
  if (!known) await load();
  const wanted = new Map(Object.entries(known).map(([p, v]) => [p.toLowerCase(), { path: p, ...v }]));
  const bar = document.getElementById('bar'); bar.hidden = false;
  let seen = 0, present = 0, identical = 0, differs = [], bytesOk = 0;
  const started = performance.now();
  const done = new Set();
  for await (const [rel, file] of entries) {
    const key = rel.toLowerCase();
    const k = wanted.get(key);
    if (!k || done.has(key)) continue;   // a second spelling of the same path counts once
    done.add(key);
    present++;
    if (file.size === k.bytes && (await sha256(file)) === k.sha256) { identical++; bytesOk += k.bytes; }
    else differs.push(k.path);
    seen++; bar.value = present / wanted.size;
    if (present % 50 === 0) say(present + ' of ' + wanted.size + ' files looked at…');
  }
  bar.hidden = true;
  const secs = ((performance.now() - started) / 1000).toFixed(1);
  const missing = wanted.size - present;
  const wad = [...wanted.values()].find(v => v.path.toLowerCase() === 'valve/halflife.wad');
  say('');
  document.getElementById('out').innerHTML =
    '<table><tr><th>files the game needs</th><td class="n">' + wanted.size + '</td></tr>' +
    '<tr><th>in your folder</th><td class="n">' + present + '</td></tr>' +
    '<tr><th class="ok">identical to the museum\'s build</th><td class="n ok">' + identical + ' (' + bytesOf(bytesOk) + ')</td></tr>' +
    '<tr><th class="bad">present but different</th><td class="n bad">' + differs.length + '</td></tr>' +
    '<tr><th>not in your folder</th><td class="n">' + missing + '</td></tr>' +
    '<tr><th>time, in this browser</th><td class="n">' + secs + ' s</td></tr></table>' +
    '<p>' + (identical === wanted.size ? '<b class="ok">This is the build the museum was made from, file for file.</b> With the next step built, a page like this would keep these ' + bytesOf(bytesOk) + ' in your browser\'s own cache and the museum would never send them.' :
      present === 0 ? 'No game files found. The folder wanted is the one with <code>valve/</code> and <code>cstrike/</code> in it — usually <code>Steam/steamapps/common/Half-Life</code>.' :
      identical > wanted.size * 0.9 ? '<b class="ok">A Half-Life install, ' + identical + ' of ' + wanted.size + ' files matching.</b> The ones that differ are usually a later Steam update or your own config; they are listed below.' :
      'A Half-Life folder, but a different build from the one the museum knows: ' + identical + ' of ' + wanted.size + ' match.') + '</p>' +
    (differs.length ? '<details><summary>' + differs.length + ' that differ</summary><p class="muted">' + differs.slice(0, 200).join(', ') + (differs.length > 200 ? ' …' : '') + '</p></details>' : '');
}

document.getElementById('pick').addEventListener('click', async () => {
  if (window.showDirectoryPicker) {
    try { const dir = await window.showDirectoryPicker({ mode: 'read' }); say('Reading ' + dir.name + '…'); await check(walkHandle(dir, '')); } catch (e) { if (e.name !== 'AbortError') say('Could not read the folder: ' + e.message); }
  } else document.getElementById('files').click();
});
document.getElementById('files').addEventListener('change', async e => { say('Reading…'); await check(walkList([...e.target.files])); });
</script></body></html>`))
}
