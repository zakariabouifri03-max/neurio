# Testing

## Automated tests

```bash
# 1. Backend API (8 tests)
cd backend
python -m pytest tests/ -q
#   - health, upload valid/invalid/corrupt, try-on e2e (file + URL garment),
#     history CRUD, error paths

# 2. AI engine (16 tests)
cd ai-engine
python -m pytest tests/ -q
#   - category normalization/placement, composite pipeline validity,
#     output-differs-from-input, background removal, provider factory

# 3. Extension detection heuristics (12 tests)
cd extension
npm run test
#   - scoring (product vs logo/avatar/icon), lazy-load boosts,
#     JSON-LD/og parsing, dedupe, malformed JSON-LD handling
```

## Manual test plan

### Extension installation
- [ ] `chrome://extensions` → Developer mode → Load unpacked → `extension/dist/`
- [ ] Icon appears in the toolbar; popup opens with the Anywear AI branding

### Product detection
- [ ] On a product page (e.g. zara.com, h&m.com, asos.com, amazon.com), click
      the icon → **Scan page** → grid of detected garment images appears
- [ ] Click **Select on page** → badges highlight candidate images → click one
- [ ] On a page with zero products → "No product images yet" state shows
- [ ] Drag a garment `<img>` from the page → popup preloads the garment

### Garment → backend path
- [ ] Same-origin image: garment uploads as a file (canvas conversion)
- [ ] Cross-origin image (no CORS headers): falls back to URL mode; the
      backend fetches it server-side; job succeeds
- [ ] Manual garment upload fallback works when detection fails

### Photo upload & try-on
- [ ] Drag-and-drop photo into the popup upload zone
- [ ] Click to open file picker; non-image files are rejected
- [ ] Category selector changes placement hints
- [ ] **Try It On** → processing screen with progress bar
- [ ] Result preview renders; **Download** saves a JPEG
- [ ] Result footer shows `mode: dev-composite · DEVELOPER MODE` in dev

### History & deletion
- [ ] Generated result appears in the popup History and the dashboard
- [ ] **Delete** removes the item and its stored files (verify `backend/data/`)
- [ ] After delete, the result URL returns 404

### Backend behavior
- [ ] `GET /api/health` reports provider + dev_mode
- [ ] Oversized upload (> MAX_UPLOAD_MB) → 413
- [ ] Corrupt/non-image file → 422
- [ ] Rate limit (> RATE_LIMIT_RPM/min) → 429
- [ ] Wrong API key (with API_KEY set) → 401
- [ ] `DELETE /api/history/{id}` twice → 200 then 404

### Dashboard
- [ ] `npm run dev` serves the dashboard; backend offline shows a warning banner
- [ ] New try-on flow end-to-end (upload both images → category → Try It On →
      progress → result → download)
- [ ] History grid, preview modal, delete
- [ ] Settings: change backend URL → health indicator updates

### Error handling
- [ ] Stop the backend → popup shows "Backend offline" toast, no crash
- [ ] Failed job (garment URL unreachable) → error toast, returns to photo step
- [ ] Close the popup mid-generation → job continues server-side; result
      appears in History on next open

## Known limitations

- `dev-composite` is a labeled CPU approximation — real neural quality requires
  the `idmvton` provider + GPU server (see AI_ENGINE.md).
- Content-script detection is heuristic; complex SPAs may need a manual pick.
  That path is fully implemented and tested.
- Chrome Web Store publishing requires a paid developer account and store
  review; local `Load unpacked` works without any account.
