# AI Engine — Model Evaluation & Deployment Guide

The Anywear AI engine is a **modular provider system**. The backend never talks
to a model directly; it talks to a `TryOnProvider` (see
`ai-engine/anywear_ai/base.py`). Two providers ship today:

| Provider        | Mode            | Requires       | Quality           |
|-----------------|-----------------|----------------|-------------------|
| `dev-composite` | local CPU       | nothing        | demonstrative (labeled DEV MODE) |
| `idmvton`       | GPU server      | 16GB+ VRAM     | production-grade  |

## Provider interface

```python
class TryOnProvider(ABC):
    def generate(self, person_image: bytes, garment_image: bytes,
                 options: TryOnOptions) -> TryOnResult: ...
```

Adding a new model (CatVTON, StableVITON, commercial API) means writing one
class implementing this interface — the backend, extension and dashboard
need zero changes.

## Open-source model evaluation

### IDM-VTON (Integrated Denoising Diffusion Model for Virtual Try-On)
- **What:** SD-1.5-based diffusion try-on; garment reference + person
  conditioning in a single pipeline. Strong identity/garment preservation.
- **License:** code is research-friendly (see repo LICENSE — typically
  Apache-2.0 / custom research terms); the SD-1.5 backbone is subject to the
  CreativeML Open RAIL-M license (use restrictions apply for certain content).
- **Hardware:** fp16 inference ≈ 12–16 GB VRAM (RTX 3060 12GB minimum, 24GB
  comfortable); training is out of scope (fine-tune on a T4/V100 class GPU).
- **Deployment:** single Docker container serving a POST /tryon endpoint;
  ~5–30s per image on a modern GPU.
- **Verdict:** chosen for the `idmvton` provider — best quality/effort ratio,
  active community, clean HTTP serving story.

### CatVTON
- **What:** garment-adaptive diffusion try-on, strong on accessories and
  structured garments; good pose robustness.
- **License:** research-only / non-commercial in several forks — verify the
  exact fork before commercial use.
- **Hardware:** ≈ 12–16 GB VRAM fp16.
- **Verdict:** excellent quality; license friction for commercial use makes it
  a second choice. The provider interface allows adding it later unchanged.

### StableVITON
- **What:** earlier SD-based pipeline; simpler, fewer controls.
- **License:** research (often non-commercial clauses).
- **Hardware:** ≈ 8–12 GB VRAM.
- **Verdict:** acceptable baseline but superseded by IDM-VTON quality.

## Deploying the `idmvton` provider

1. **Inference server.** Any container exposing:

   ```
   POST /tryon   multipart: person, garment, category, options(json)
                  → {"image": "<base64>", "provider": "idmvton"}
   GET  /health → {"status":"ok","gpu":true}
   ```

   Example with a community IDM-VTON serving wrapper:

   ```bash
   docker run --gpus all -p 8001:8001 \
     -v $PWD/models:/models \
     idmvton-server:latest
   ```

2. **Backend env:**

   ```bash
   AI_PROVIDER=idmvton
   AI_ENGINE_URL=http://localhost:8001
   AI_ENGINE_API_KEY=your-key      # optional bearer auth
   ```

3. **Health check:** `curl http://localhost:8000/api/health` →
   `provider: "idmvton"`, `provider_available: true`, `gpu: true`.

## The dev-composite provider (default)

Runs on pure CPU with Pillow — real image processing, not a placeholder:

1. Garment cutout: flood-fill background removal from edge color sampling.
2. Feathered alpha edges (Gaussian blur on the mask).
3. Category-aware placement (per-category torso/leg ratios in
   `categories.py`) with scaled alpha-compositing.
4. Strength blend + bounded output size + a visible "DEV MODE · composite"
   label baked into the image, so nobody mistakes it for neural output.

It exists so the entire product (extension, backend, jobs, history,
dashboard) is developable, testable and demoable without GPU infrastructure.
Swapping to IDM-VTON is one environment variable.
