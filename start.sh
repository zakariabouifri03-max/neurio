#!/bin/bash
# SOLARA BAY — Start Game (Linux/Mac)
echo "🌴 SOLARA BAY — Starting..."
if command -v xdg-open >/dev/null; then
  xdg-open SolaraBay.html
elif command -v open >/dev/null; then
  open SolaraBay.html
else
  echo "Open SolaraBay.html in your browser (double-click)"
fi
# Fallback: serve via python if file:// fails due to CORS (not needed for single-file)
# python3 -m http.server 8000 --directory . &
# xdg-open http://localhost:8000/SolaraBay.html
