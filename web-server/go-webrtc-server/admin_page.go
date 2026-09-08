package main

const adminTemplate = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>cs16 — the controls</title>
<style>
 body { margin:0; background:#14130f; color:#e8e2d2; font:16px/1.55 system-ui, sans-serif; }
 main { max-width: 720px; margin:0 auto; padding:40px 24px 72px; }
 h1 { font-size:1.5rem; margin:0 0 4px; }
 .where { color:#9a9384; margin:0 0 28px; font-size:.95rem; }
 fieldset { border:1px solid #2e2b22; border-radius:8px; padding:16px 18px; margin:0 0 18px; }
 legend { color:#d9c37a; padding:0 6px; font-weight:600; }
 label.row { display:block; padding:5px 0; }
 select, input[type=text] { background:#23211a; color:#e8e2d2; border:1px solid #3a352a; border-radius:5px; padding:7px 9px; font:inherit; min-width:240px; }
 .choices { display:flex; flex-wrap:wrap; gap:14px; }
 .choices label { display:flex; gap:6px; align-items:baseline; }
 .note { color:#9a9384; font-size:.88rem; margin:6px 0 0; }
 button { background:#d9c37a; color:#14130f; border:0; border-radius:6px; padding:11px 20px; font:inherit; font-weight:600; cursor:pointer; }
 button.quiet { background:#2e2b22; color:#e8e2d2; }
 .said { border-radius:8px; padding:12px 16px; margin:0 0 22px; }
 .good { background:#1d2a1c; border:1px solid #3c5c39; }
 .bad { background:#2c1b1b; border:1px solid #6b3a3a; }
 .buttons { display:flex; gap:12px; align-items:center; }
 a { color:#f0d47a; }
</style></head><body><main>
<h1>The controls</h1>
<p class="where">These settings are written into the mode itself, so they survive a map change and a restart — the server stays this way until you change it here. <a href="/play">go and play</a> · <a href="/">what this is</a></p>
{{if .Message}}<p class="said good">{{.Message}}</p>{{end}}
{{if .Problem}}<p class="said bad">{{.Problem}}</p>{{end}}
<form method="post">
 <fieldset><legend>The game</legend>
  <label class="row">Game type
   <select name="mode" id="mode">
    {{$mode := .Mode}}{{range .Modes}}<option value="{{.Name}}" {{if eq .Name $mode}}selected{{end}}>{{.Display}} — {{.Purpose}}</option>{{end}}
   </select></label>
  <label class="row">Map
   <select name="map" id="map">
    <option value="">leave it on {{if .Map}}{{.Map}}{{else}}whatever it is playing{{end}}</option>
   </select></label>
  <p class="note">Every map lasts fifteen minutes.</p>
 </fieldset>
 <fieldset><legend>How it plays</legend>
  <div class="choices">{{$g := .Gravity}}{{range gravities}}
   <label><input type="radio" name="gravity" value="{{.}}" {{if eqi . $g}}checked{{end}}>{{.}}</label>{{end}}
  </div>
  <p class="note">Gravity. 800 is normal; 400 is the moon; 100 is a balloon.</p>
  <label class="row"><input type="checkbox" name="bhop" {{if .Bhop}}checked{{end}}> Bunny hopping</label>
  <div id="funds"><label class="row"><input type="checkbox" name="funds" value="max" {{if .MaxFunds}}checked{{end}}> Everyone starts with $16,000</label>
  <p class="note">Classic only. Unticked is the usual $800.</p></div>
 </fieldset>
 <div class="buttons">
  <button name="restart" value="off" type="submit">Apply now</button>
  <button name="restart" value="on" type="submit" class="quiet">Apply and restart the server</button>
 </div>
 <p class="note">Applying takes effect on the next map, which it changes to straight away — nobody is disconnected. Restarting takes about twenty seconds and everybody has to rejoin.</p>
</form>
<script>
 // The maps each game type offers, and the money row that only classic has.
 const maps = {{.MapsJSON}};
 const mode = document.getElementById('mode'), list = document.getElementById('map'), funds = document.getElementById('funds');
 const chosenMap = {{.Map}};
 function refresh() {
   const keep = list.value;
   list.length = 1;
   for (const name of (maps[mode.value] ?? [])) {
     const option = new Option(name, name);
     if (name === keep || name === chosenMap) option.selected = true;
     list.add(option);
   }
   funds.hidden = mode.value !== 'classic';
 }
 mode.addEventListener('change', () => { list.value = ''; refresh(); });
 refresh();
</script>
</main></body></html>`
