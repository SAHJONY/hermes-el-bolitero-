# Free / Open-Source AI Generation Stack — Cuba Libre Casino

Goal: generate the **photoreal cinematic background** (and, later, video) for the
Cuba Libre Casino hero **without paying a Higgsfield subscription**, using fully
open-source tools. The app's hero is already wired to drop the result in (see
"Plug it into the app" below).

> **Reality check on *this* environment:** this Claude session runs in a remote
> cloud container with **no GPU**. The open-source image/video models below need
> a GPU (local or rented). So I can't render the photo *inside this session* —
> what I've done instead is (1) ship the free CSS/SVG cinematic hero that needs
> **zero** GPU, and (2) wire the hero so a `casino-bg.jpg` you generate with this
> stack appears automatically. Run the stack on your own RTX card or a cheap
> cloud GPU, then commit the image.

---

## The recommended free stack

| Layer | Tool | License | Commercial use | Notes |
|------|------|---------|----------------|-------|
| Workflow engine | **ComfyUI** | GPL-3.0 | ✅ | Node graph for image+video pipelines |
| Cinematic images | **FLUX.1 [schnell]** | **Apache-2.0** | ✅ **yes** | Use *schnell* for a commercial app |
| Cinematic images (max quality) | FLUX.1 [dev] | FLUX Dev non-commercial | ⚠️ **non-commercial** | Great quality, but **not** for a paid product |
| Image alt | SDXL + Juggernaut/RealVis | varies (mostly OK) | ✅/⚠️ | Lighter on VRAM than FLUX |
| Video | **Wan 2.2** (and 2.1) | **Apache-2.0** | ✅ **yes** | Strongest free open video model today |
| Video alt | Hunyuan Video (Tencent) | Tencent community license | ⚠️ check terms | Excellent, license has limits |
| Motion/camera | AnimateDiff | Apache-2.0 | ✅ | Adds camera motion to stills |
| Self-host UI | Open WebUI | MIT/BSD-style | ✅ | Chat/agent front-end |
| Automation | n8n | Sustainable-Use (fair-code) | ✅ for internal | Pipeline orchestration |

**Licensing bottom line for a commercial gambling-*entertainment* app:** prefer
**FLUX.1 [schnell]** (Apache-2.0) and **Wan 2.2** (Apache-2.0). Avoid FLUX.1
**[dev]** for production assets — its license is non-commercial. ComfyUI itself
(GPL-3.0) is fine to *use* to produce assets.

---

## Hardware / where to run it

**Local GPU** (one-time cost, then free):
- RTX 4070 (12 GB) → usable (SDXL easily; FLUX with quantized/GGUF weights)
- RTX 4080 / 4090 → very good → excellent for FLUX + Wan
- 8 GB VRAM → possible with quantized models, slower

**No GPU? Rent one (cheapest path to start):**
- **RunPod** — pick a "ComfyUI" community template, A40/4090 pod ≈ **$0.30–0.70/hr**
- **Vast.ai** — bid on spot GPUs, often cheapest
- **TensorDock** — simple hourly GPUs

A single hero image is a couple minutes of GPU time → **a few cents**. Even a
batch of variations + a short Wan video clip is **<$1**.

### 10-minute cloud quickstart (RunPod)
1. RunPod → Deploy → search templates for **ComfyUI** → pick an RTX 4090 pod.
2. Open the ComfyUI web URL the pod exposes.
3. Manager → install the **FLUX** workflow; download `flux1-schnell` weights +
   `ae.safetensors` (VAE) + the two text encoders (`clip_l`, `t5xxl`).
4. Load a FLUX text-to-image workflow, paste the prompt below, set 1536×864.
5. Queue → download the PNG → save it into this repo as `casino-bg.jpg`.

---

## The prompt (copy/paste into FLUX / ComfyUI)

**Positive:**
```
Cinematic 8K photoreal wide shot of a luxurious tropical Havana casino paradise
at golden-hour sunset, glowing Cuban-deco casino skyline reflecting on a calm
Caribbean sea, silhouetted palm trees framing the foreground, warm magenta-to-amber
sky, soft volumetric god rays, gentle film grain, anamorphic lens flare, rich
teal-and-gold color grade, deep depth of field, ultra-detailed, premium luxury
travel-poster mood, no text, no watermark
```

**Negative:**
```
text, letters, watermark, logo, people faces, distorted architecture, lowres,
oversaturated, cartoon, blurry, jpeg artifacts, extra limbs
```

**Settings:** 16:9 (1536×864 or 1920×1080), FLUX schnell 4–8 steps (or dev 20–28
steps if non-commercial test only), guidance ~3.5. Generate 4, pick the best.

> Tip: the hero overlays the vectorial neon "CUBA LIBRE CASINO" sign on top, so
> generate the background **with no text** and keep the upper-center area uncluttered.

---

## Plug it into the app (already wired)

The hero component (`app/p1.txt` → `CasinoHero`) already renders an optional
photoreal layer:

```jsx
<img src="/casino-bg.jpg" ... onError={()=>setHasBg(false)} />
```

So the integration is literally:

1. Generate the image with the stack above.
2. Save it to the **repo root** as `casino-bg.jpg` (≈1600px wide, optimized).
3. Commit & deploy. The hero auto-detects it, blends the vectorial scene over it
   (`mix-blend-mode: luminosity`, 86% opacity) for the photoreal-+-vector "mix".
   If the file is absent, the hero gracefully shows the pure CSS cinematic scene.

Optimize before committing (keeps the PWA fast):
```
# needs the repo's existing 'sharp' devDependency
node -e "require('sharp')('in.png').resize(1600).jpeg({quality:82}).toFile('casino-bg.jpg')"
```

### Optional: living background (video)
Generate a 3–5s seamless loop with **Wan 2.2** (subtle waves + drifting clouds),
export `casino-bg.mp4`, and swap the `<img>` for a muted autoplay `<video>` loop.
Left as a follow-up so it doesn't bloat the PWA by default.

---

## Where Higgsfield still fits
Higgsfield (the MCP already hooked into the **Studio** tab) is a *hosted,
pay-per-credit* convenience layer over similar models — zero setup, no GPU. The
open-source stack above is the **$0-software** alternative when you have (or rent)
a GPU. Both can output the same `casino-bg.jpg` the hero consumes.
