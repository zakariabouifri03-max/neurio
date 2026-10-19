#!/usr/bin/env python3
"""
Neurio Web Demo — fallback for sandbox / preview
Run: python app/web_app.py
Then open http://localhost:7860
Same engine as desktop: remove bg + enhance.
No Qt required — works with Flask (built-in http.server + Pillow).
"""

import io, os, base64, json, traceback
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import sys
sys.path.insert(0, str(Path(__file__).parent))
from processor import process_image, HAS_REMBG, HAS_CV2

PORT = int(os.environ.get("PORT", "7860"))

HTML_PAGE = r"""
<!DOCTYPE html>
<html lang="ar" dir="ltr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>◆ NEURIO — Hayed Background + Zid Quality</title>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;600;700&family=Tajawal:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Fredoka','Tajawal',system-ui,sans-serif;background:#0f111a;color:#f3f4f6;min-height:100vh}
a{color:#60a5fa}
.header{background:linear-gradient(90deg,#1a1e2e 0%,#1e2a4a 50%,#1a1e2e 100%);border-bottom:1px solid #232a3a;padding:14px 20px;display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.logo{color:#6ee7b7;font-weight:800;font-size:20px;letter-spacing:1px}
.tag{color:#a5b4fc;font-size:13px;font-weight:600}
.dash{color:#6b7285;font-size:11px}
.container{max-width:1200px;margin:18px auto;padding:0 16px}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.btn{border-radius:10px;padding:10px 16px;font-weight:700;font-size:13px;border:1px solid transparent;cursor:pointer}
.btn-primary{background:linear-gradient(90deg,#3b82f6,#2563eb);color:#fff;border-color:#3b82f6}
.btn-secondary{background:#232836;color:#e5e7eb;border-color:#2d3346}
.btn-accent{background:linear-gradient(90deg,#8b5cf6,#7c3aed);color:#fff;border-color:#8b5cf6}
.btn-gold{background:linear-gradient(90deg,#f59e0b,#d97706);color:#fff;border-color:#f59e0b}
.btn-save{background:linear-gradient(90deg,#10b981,#059669);color:#fff;border-color:#10b981;padding:10px 22px}
.btn:disabled{opacity:.45;cursor:not-allowed}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:800px){.cards{grid-template-columns:1fr}}
.card{background:#161a27;border:1px solid #232a3a;border-radius:16px;padding:14px}
.card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.card-title{font-weight:800;font-size:14px}
.badge{background:#1e2435;color:#60a5fa;border:1px solid #2d3a5e;border-radius:6px;padding:2px 8px;font-size:10px;font-weight:700}
.card-sub{color:#6b7280;font-size:11px;margin-bottom:10px}
.preview{width:100%;min-height:280px;background:#1a1e29;border:2px dashed #3a4050;border-radius:14px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.preview.has-img{border-style:solid;background:repeating-conic-gradient(#2a2f3a 0% 25%, #3a4050 0% 50%) 50% / 20px 20px}
.preview img{max-width:100%;max-height:420px;display:block}
.preview.output.has-img{background:repeating-conic-gradient(#2a2f3a 0% 25%, #3a4050 0% 50%) 50% / 16px 16px}
.drop-active{border-color:#3b82f6 !important;background:#1e2435 !important}
.info{margin-top:8px;color:#9ca3af;font-size:11px;background:#1e222c;border-radius:8px;padding:6px;text-align:center}
.controls{background:#161a27;border:1px solid #232a3a;border-radius:12px;padding:12px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:16px}
.ctrl-label{color:#9ca3af;font-size:11px;font-weight:600}
.ctrl-group{display:flex;align-items:center;gap:6px}
select,input[type=range]{background:#1e222c;color:#e5e7eb;border:1px solid #2d3346;border-radius:8px;padding:6px 10px}
input[type=range]{padding:0;width:110px}
.chk{color:#d1d5db;font-size:11px;font-weight:600}
.status-row{display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap}
.status{color:#9ca3af;font-size:12px;font-weight:600}
.progress{height:8px;flex:1;max-width:360px;background:#1e222c;border:1px solid #232a3a;border-radius:4px;overflow:hidden;display:none}
.progress-bar{height:100%;width:50%;background:linear-gradient(90deg,#3b82f6,#8b5cf6);animation:load 0.9s infinite ease-in-out}
@keyframes load{0%{margin-left:-50%}100%{margin-left:100%}}
.engine{color:#6b7280;font-size:10px;background:#1a1e29;border:1px solid #232a3a;border-radius:6px;padding:4px 8px}
.drop-hint{color:#8a90a5;text-align:center;padding:30px 10px;line-height:1.6}
.file-input{display:none}
.footer{text-align:center;color:#4b5563;font-size:11px;margin:20px 0}
</style>
</head>
<body>
<div class="header">
  <div class="logo">◆ NEURIO</div>
  <div class="tag">Hayed Background • Zid Quality • HD 4K</div>
  <div class="dash">— Kaykhdem 100% offline — sari3 bzzaf ⚡</div>
  <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
    <span class="engine">ENGINE: PY-READY</span>
    <button class="btn btn-secondary" style="padding:6px 10px;font-size:11px" onclick="showHelp()">❔ Help</button>
  </div>
</div>

<div class="container">
  <div class="toolbar">
    <button class="btn btn-primary" onclick="pickFile()">📁 Khtar Taswira</button>
    <button class="btn btn-secondary" id="btnBg" disabled onclick="doProcess('bg')">✂️ Hayed Background</button>
    <button class="btn btn-accent" id="btnHd" disabled onclick="doProcess('hd')">✨ Zid Quality</button>
    <button class="btn btn-gold" id="btnBoth" disabled onclick="doProcess('both')">⚡ Bjouj (BG + HD)</button>
    <div style="flex:1"></div>
    <button class="btn btn-save" id="btnSave" disabled onclick="saveResult()">💾 Hfed / Save</button>
    <button class="btn btn-secondary" onclick="resetAll()">↺ Reset</button>
  </div>

  <div class="cards">
    <div class="card" id="cardInput">
      <div class="card-head"><div class="card-title">🖼️ Taswira L-asliya</div><span class="badge">INPUT</span></div>
      <div class="card-sub">Drag & drop aw klick bach tkhtar fichier (JPG, PNG, WEBP)</div>
      <div class="preview" id="previewIn">
        <div class="drop-hint">📁<br><b>Jor taswira hna</b><br>Drag & Drop<br><br>aw klick "Khtar Taswira"</div>
      </div>
      <div class="info" id="infoIn">Mazal makhtartish — 0×0</div>
    </div>
    <div class="card">
      <div class="card-head"><div class="card-title">✨ Natija (Transparent)</div><span class="badge">OUTPUT</span></div>
      <div class="card-sub">Background mhayed + quality mziyada — jahza l save</div>
      <div class="preview output" id="previewOut">
        <div class="drop-hint">✨<br><b>Natija ghadi tban hna</b><br>Click "Hayed Background" aw "Zid Quality"</div>
      </div>
      <div class="info" id="infoOut">Natija ghadi tban hna ✨</div>
    </div>
  </div>

  <div class="controls">
    <span class="ctrl-label">📐 Tkabir:</span>
    <select id="scale"><option value="1">1× Asli</option><option value="2" selected>2× HD (ns7ek)</option><option value="4">4× Ultra HD</option></select>
    <span class="ctrl-label">🪞 Sharpen:</span>
    <div class="ctrl-group"><input type="range" id="sharpen" min="0" max="100" value="55"><span class="ctrl-label" id="sharpVal">1.35×</span></div>
    <label class="chk"><input type="checkbox" id="denoise" checked> 🧹 Denoise</label>
    <label class="chk"><input type="checkbox" id="colorBoost" checked> 🎨 Zid Lawn</label>
    <div style="flex:1"></div>
    <span class="ctrl-label">Save as:</span>
    <select id="fmt"><option value="png">PNG (transparent)</option><option value="jpg">JPG (blanc)</option><option value="webp">WEBP (sghir)</option></select>
  </div>

  <div class="status-row">
    <div class="status" id="status">Marhba! Khtar taswira bach tbda ✨</div>
    <div class="progress" id="progress"><div class="progress-bar"></div></div>
    <div class="engine" id="engineBadge">rembg — fallback ready • opencv</div>
  </div>

  <div class="footer">
    Neurio Desktop (.exe) — <a href="#" onclick="showHelp();return false">kifach tkhdem</a> • CLI: <code>python app/main.py --cli input.jpg -o out.png --scale 2</code>
  </div>
</div>

<input type="file" id="fileIn" class="file-input" accept="image/*">

<script>
let inputDataUrl = null;
let outputDataUrl = null;
let outputName = "neurio_output.png";

const $ = (s)=>document.querySelector(s);
function status(t){$("#status").textContent=t}
function busy(b){$("#progress").style.display=b?'block':'none';["btnBg","btnHd","btnBoth","btnSave"].forEach(id=>{const e=$("#"+id); if(b) e.setAttribute("disabled","");}); if(!b && inputDataUrl){["btnBg","btnHd","btnBoth"].forEach(id=>$("#"+id).removeAttribute("disabled")); if(outputDataUrl) $("#btnSave").removeAttribute("disabled");}}
function sharpVal(v){let n; if(v<=50) n=0.5+(v/50)*0.8; else n=1.3+((v-50)/50)*1.2; return n}
$("#sharpen").addEventListener("input", e=>{$("#sharpVal").textContent=sharpVal(e.target.value).toFixed(2)+"×"})

function pickFile(){ $("#fileIn").click()}
$("#fileIn").addEventListener("change", e=>{ if(e.target.files[0]) loadFile(e.target.files[0])})

function loadFile(file){
  if(!file.type.startsWith("image/")){ alert("Khtar ghir taswira!"); return}
  const reader=new FileReader();
  reader.onload=()=>{
    inputDataUrl=reader.result;
    showImage("#previewIn", inputDataUrl);
    outputDataUrl=null;
    $("#previewOut").innerHTML='<div class="drop-hint">✨<br><b>Natija ghadi tban hna</b><br>Click "Hayed Background" aw "Zid Quality"</div>';
    $("#previewOut").classList.remove("has-img");
    $("#infoOut").textContent="Natija ghadi tban hna ✨";
    // get dimensions
    const img=new Image();
    img.onload=()=>{ $("#infoIn").textContent=`${img.width}×${img.height} • ${file.name} • ${(file.size/1024).toFixed(1)} KB` }
    img.src=inputDataUrl;
    outputName=file.name.replace(/\.[^.]+$/,'')+"_neurio.png";
    status(`Loaded: ${file.name} ✅`);
    busy(false);
  };
  reader.readAsDataURL(file);
}

function showImage(sel, dataUrl){
  const el=$(sel);
  el.innerHTML=`<img src="${dataUrl}" alt="preview">`;
  el.classList.add("has-img");
}

// Drag & Drop
["previewIn","cardInput"].forEach(id=>{
  const el=document.getElementById(id);
  el.addEventListener("dragover", e=>{e.preventDefault(); $("#previewIn").classList.add("drop-active")});
  el.addEventListener("dragleave", ()=>$("#previewIn").classList.remove("drop-active"));
  el.addEventListener("drop", e=>{
    e.preventDefault(); $("#previewIn").classList.remove("drop-active");
    const f=e.dataTransfer.files[0];
    if(f) loadFile(f);
  });
});
// click preview to pick
$("#previewIn").addEventListener("click", pickFile);

async function doProcess(mode){
  if(!inputDataUrl){ alert("Loul khtar taswira!"); return}
  busy(true);
  const payload = {
    image: inputDataUrl,
    mode: mode,
    scale: parseInt($("#scale").value),
    sharpen: sharpVal(parseInt($("#sharpen").value)),
    denoise: $("#denoise").checked,
    colorBoost: $("#colorBoost").checked,
    format: $("#fmt").value
  };
  const labels={bg:"Kayhayed background... ⏳",hd:"Kayzid quality... ✨",both:"Hayed BG + Zid Quality... ⏳✨"};
  status(labels[mode]||"Kaykhdem...");

  try{
    const res=await fetch("/process",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
    const j=await res.json();
    if(!j.ok) throw new Error(j.error||"Erreur");
    outputDataUrl=j.image;
    showImage("#previewOut", outputDataUrl);
    $("#infoOut").textContent=`${j.width}×${j.height} • ${j.mode} • ${mode==="bg"?"BG mhayed ✅":mode==="hd"?"HD ✨":"BG mhayed + HD ✨"}`;
    status(labels[mode]+" Done ✅ — qabel l save 💾");
    $("#btnSave").removeAttribute("disabled");
    // auto set output name ext
    let ext=j.format||payload.format||"png";
    outputName=outputName.replace(/\.[^.]+$/,'') + "."+ext;
  }catch(e){
    console.error(e);
    status("Erreur ❌ — "+e.message);
    alert("Erreur: "+e.message);
  }finally{busy(false)}
}

function saveResult(){
  if(!outputDataUrl) return;
  const a=document.createElement("a");
  a.href=outputDataUrl;
  a.download=outputName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  status(`Thfedat ✅ — ${outputName}`);
}

function resetAll(){
  inputDataUrl=null; outputDataUrl=null;
  $("#previewIn").innerHTML='<div class="drop-hint">📁<br><b>Jor taswira hna</b><br>Drag & Drop<br><br>aw klick "Khtar Taswira"</div>';
  $("#previewIn").classList.remove("has-img");
  $("#previewOut").innerHTML='<div class="drop-hint">✨<br><b>Natija ghadi tban hna</b><br>Click "Hayed Background" aw "Zid Quality"</div>';
  $("#previewOut").classList.remove("has-img");
  $("#infoIn").textContent="Mazal makhtartish — 0×0";
  $("#infoOut").textContent="Natija ghadi tban hna ✨";
  ["btnBg","btnHd","btnBoth","btnSave"].forEach(id=>$("#"+id).setAttribute("disabled",""));
  status("Reset ✅ — Khtar taswira jdida");
}
function showHelp(){
  alert(`◆ NEURIO — Hayed Background + Zid Quality

1️⃣ KHTAR TASWIRA: Click aw drag & drop
2️⃣ HAYED BACKGROUND: kayhayed arrière-plan → PNG transparent
3️⃣ ZID QUALITY: upscale 2×/4× + denoise + sharpen + color
4️⃣ BJOUJ: dirhom bjouj f nafs wa9t
5️⃣ HFED: PNG / JPG / WEBP

Options: upscale 1×/2×/4×, sharpen 0.5-2.5, denoise, zid lawn.
Awal marra: model 176MB kayt-telechargi (internet). Men ba3d offline 100%.

Desktop exe: python app/build.py → dist/Neurio.exe
CLI: python app/main.py --cli input.jpg -o out.png --scale 2
Web: python app/web_app.py → http://localhost:7860`);
}
</script>
</body>
</html>
"""

class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[web] {format % args}")

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/index.html"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(HTML_PAGE.encode("utf-8"))
        elif parsed.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True, "rembg": HAS_REMBG, "cv2": HAS_CV2}).encode())
        else:
            self.send_response(404)
            self.end_headers()
            self.wfile.write(b"Not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/process":
            self.send_response(404)
            self.end_headers()
            return
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        try:
            data = json.loads(body)
            image_data = data.get("image", "")
            mode = data.get("mode", "both")
            scale = int(data.get("scale", 2))
            sharpen = float(data.get("sharpen", 1.35))
            denoise = bool(data.get("denoise", True))
            colorBoost = bool(data.get("colorBoost", True))
            out_format = data.get("format", "png").lower()

            # Decode data URL
            if "," in image_data:
                header, b64 = image_data.split(",", 1)
            else:
                b64 = image_data
            img_bytes = base64.b64decode(b64)
            # Save temp input
            from PIL import Image, ImageOps
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp.write(img_bytes)
                tmp_path = tmp.name

            # Determine actions
            remove_bg = mode in ("bg", "both")
            enhance = mode in ("hd", "both")

            from processor import process_image
            result = process_image(
                tmp_path,
                remove_bg=remove_bg,
                enhance=enhance,
                scale=scale if enhance else 1,
                sharpen=sharpen,
                denoise=denoise,
                color_boost=colorBoost,
            )
            os.unlink(tmp_path)

            # Encode result to requested format
            buf = io.BytesIO()
            if out_format == "jpg" or out_format == "jpeg":
                # composite on white if RGBA
                if result.mode == "RGBA":
                    bg = Image.new("RGB", result.size, (255,255,255))
                    bg.paste(result, mask=result.split()[3])
                    result = bg
                result.convert("RGB").save(buf, "JPEG", quality=95)
                mime = "image/jpeg"
                ext = "jpg"
            elif out_format == "webp":
                result.save(buf, "WEBP", quality=90)
                mime = "image/webp"
                ext = "webp"
            else:
                result.save(buf, "PNG", optimize=True)
                mime = "image/png"
                ext = "png"

            b64_out = base64.b64encode(buf.getvalue()).decode("utf-8")
            data_url = f"data:{mime};base64,{b64_out}"

            resp = {
                "ok": True,
                "image": data_url,
                "width": result.width,
                "height": result.height,
                "mode": result.mode,
                "format": ext,
            }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(resp).encode())

        except Exception as e:
            traceback.print_exc()
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode())

def run():
    print(f"◆ Neurio Web — http://0.0.0.0:{PORT}")
    print(f"  rembg={HAS_REMBG} cv2={HAS_CV2}")
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping...")

if __name__ == "__main__":
    run()
