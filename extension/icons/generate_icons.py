import subprocess
import os

svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b" />
      <stop offset="50%" stop-color="#312e81" />
      <stop offset="100%" stop-color="#0f172a" />
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a" />
      <stop offset="50%" stop-color="#f59e0b" />
      <stop offset="100%" stop-color="#d97706" />
    </linearGradient>
    <linearGradient id="fire" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fb923c" />
      <stop offset="100%" stop-color="#ef4444" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background rounded squircle -->
  <rect x="4" y="4" width="120" height="120" rx="28" fill="url(#bg)" stroke="#6366f1" stroke-width="2.5" />

  <!-- Radar / Opportunity circles in background -->
  <circle cx="58" cy="58" r="42" fill="none" stroke="#4338ca" stroke-width="1.5" stroke-dasharray="4,4" opacity="0.6" />
  <circle cx="58" cy="58" r="28" fill="none" stroke="#6366f1" stroke-width="1.5" opacity="0.4" />

  <!-- Magnifying glass lens handle -->
  <path d="M78 78 L108 108" stroke="url(#gold)" stroke-width="9" stroke-linecap="round" />
  <path d="M84 84 L104 104" stroke="#78350f" stroke-width="3" stroke-linecap="round" opacity="0.6" />

  <!-- Magnifying glass rim -->
  <circle cx="58" cy="58" r="32" fill="#1e1b4b" fill-opacity="0.7" stroke="url(#gold)" stroke-width="7" />
  
  <!-- Gem / Trophy / Star inside magnifying glass -->
  <!-- Flame & Star symbol for Hidden Winner -->
  <path d="M58 36 L62 46 L73 48 L65 56 L67 67 L58 62 L49 67 L51 56 L43 48 L54 46 Z" fill="url(#gold)" filter="url(#glow)" />
  
  <!-- Little discovery sparkle -->
  <path d="M84 32 L86 38 L92 40 L86 42 L84 48 L82 42 L76 40 L82 38 Z" fill="#38bdf8" />
  <circle cx="34" cy="74" r="2.5" fill="#34d399" />
</svg>"""

with open("extension/icons/icon.svg", "w") as f:
    f.write(svg_content)

sizes = [16, 32, 48, 128]
for size in sizes:
    out_png = f"extension/icons/icon{size}.png"
    cmd = ["convert", "-background", "none", "-resize", f"{size}x{size}", "extension/icons/icon.svg", out_png]
    subprocess.run(cmd, check=True)
    print(f"Generated {out_png}")

