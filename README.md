# AdForge

Turn product photos into cinematic video ads using a multi-model AI pipeline.

**Live demo:** [adforge-three.vercel.app](https://adforge-three.vercel.app) — just upload an image and go, API keys are pre-configured.

![AdForge Screenshot](screenshot.png)

## How It Works

AdForge chains three AI models together to go from a single product photo to a polished video ad:

1. **Gemini Vision** (gemini-2.0-flash) — Analyzes the product photo to extract product details, colors, materials, shape, and suggests creative camera angles and scene direction.

2. **Gemini Imagen** (gemini-2.0-flash-exp-image-generation) — Generates an enhanced first frame (product in a professional setting) and an alternate-angle end frame, both styled to match the selected ad tone.

3. **LTX-2 Video** (ltx-2-pro / ltx-2-fast) — Generates a cinematic video ad from the enhanced first frame, with camera motion that reveals the product from multiple angles.

## Features

- **AI-powered product analysis** — Automatic detection of product type, colors, materials, and optimal camera angles
- **Enhanced first frame** — AI-generated professional product photography background, adapted to ad tone
- **Alternate angle end frame** — AI-generated view of the product from a different perspective, style-matched to the first frame
- **Three ad tones** — Fun & Energetic, Premium & Elegant, Urgent & Bold — each affects image backgrounds, lighting, and video atmosphere
- **Target audience integration** — Audience description influences all generated content
- **Editable prompts** — Full control over the LTX-2 video prompt
- **Duration control** — 6s to 20s (auto-switches to LTX-2 Fast for durations over 10s)
- **Camera motion selection** — Dolly, jib, static, focus shift — AI suggests the best one
- **Audio generation** — Optional AI-generated audio for the video
- **Video Journey preview** — Side-by-side first frame and end frame before generating

## Technical Challenges & Solutions

### CORS & API Proxy

LTX-2's API doesn't support browser-origin requests. Rather than building a backend server, I configured a Vite dev proxy and Vercel rewrites (`vercel.json`) to transparently route `/api/*` to `https://api.ltx.video/v1/*` — keeping the app fully client-side with zero backend code.

### Chained Image Generation for Style Consistency

A naive approach would generate the enhanced first frame and alternate-angle end frame in parallel. The problem: they'd have completely different backgrounds and lighting, making the video transition look jarring.

**Solution:** Chain the calls sequentially — generate the enhanced first frame first, then feed that enhanced image as the source for the alt-angle generation. The alt-angle prompt explicitly instructs Gemini to use the *exact same background, props, and lighting* so both frames feel like they belong in the same scene.

```
Original Photo → Enhanced First Frame (new background) → Alt Angle End Frame (same background, different angle)
```

### Context-Aware Prompt Engineering

Early versions used a single "dark studio" background for every product. A children's toy in a dark moody studio looked wrong. The fix: prompts dynamically adapt to the product's personality — toys get playful colorful settings, electronics get sleek modern desks, food gets warm kitchens, etc. This is driven by the Gemini Vision analysis, not hardcoded categories.

### Tone & Audience Flow-Through

The ad tone (Fun/Premium/Urgent) and target audience don't just affect the video — they flow through the entire pipeline:

| Setting | Enhanced First Frame | Alt Angle End Frame | LTX-2 Video Prompt |
|---------|---------------------|--------------------|--------------------|
| **Fun** | Bright, colorful, playful lighting | Matches first frame | Warm studio, golden light, colorful bokeh |
| **Premium** | Dark, elegant, moody lighting | Matches first frame | Moody studio, key light, mist, shallow DOF |
| **Urgent** | Bold, high-contrast, striking | Matches first frame | High-contrast, dramatic streaks, deep shadows |

The audience text (e.g. "fitness enthusiasts aged 25-35") is injected into every prompt so the AI tailors the aesthetic to the target demographic.

### Auto Model Switching

LTX-2 Pro supports up to 10s of video with higher quality; LTX-2 Fast supports up to 20s. Instead of making users think about model selection, the app auto-switches based on the duration they pick — transparent to the user, optimal for quality.

### Binary Response Handling

LTX-2's API returns raw MP4 bytes directly (not a URL or job ID). The app handles this with `res.blob()` → `URL.createObjectURL()` for instant in-browser playback without any intermediate storage.

## Architecture

```
Product Photo
    │
    ▼
Gemini Vision (analysis → JSON: product, colors, material, shape, camera, alternate_angle)
    │
    ├──▶ Gemini Imagen (enhanced first frame — tone-aware, audience-aware)
    │        │
    │        └──▶ Gemini Imagen (alt angle end frame — style-matched to enhanced frame)
    │
    ├──▶ Build LTX-2 prompt (tone environment + audience + analysis fields)
    │
    ▼
LTX-2 Video API (image-to-video, binary MP4 response)
    │
    ▼
In-browser video playback + download
```

## Tech Stack

- **React 19** + TypeScript 5.9 — single-file architecture (~940 lines), no routing needed
- **Vite 7** — dev server with API proxy, fast builds
- **TailwindCSS 4** — utility-first styling, dark theme
- **Gemini API** — Vision (analysis) + Imagen (image generation), both via REST
- **LTX Video API** — image-to-video generation by Lightricks

## Run Locally

```bash
npm install
npm run dev
```

Open [localhost:5173](http://localhost:5173). Demo API keys are included. To use your own, click "API Keys" in the header.

## Deployment

Deployed on Vercel with API rewrites in `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://api.ltx.video/v1/:path*" }
  ]
}
```

```bash
npm run build
vercel --prod
```
