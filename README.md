# tripo-downloader

Downloads the actual 3D model from a `studio.tripo3d.ai` model page as a
plain `.stl` (pure geometry — vertices and triangles, no color/texture/
material), without needing Tripo's paywalled "Export" button.

## How it works

Tripo's viewer is a Nuxt/Vue app running a custom ECS-based 3D engine (not
plain TresJS). The already-generated, already-decoded mesh lives in memory
as a real `THREE.Mesh`, reachable at:

```
ViewerCanvas (Vue component) .props.engine.system.model.entityMesh[0].ref
```

`inject.js` walks the live Vue component tree to find that mesh, reads its
raw geometry (position + index — already dequantized by the browser's own
loader, no compression to deal with), computes a proper face normal per
triangle, and assembles a standard binary STL in memory, then triggers a
normal browser download.

`tripo_download.py` drives this via Playwright, attached over CDP to a real,
already-logged-in Brave window (see "Why a real browser" below) — it opens
the link, waits for the mesh to finish loading, runs `inject.js`, and saves
the resulting download to `~/Desktop`.

## Why a real, already-logged-in browser (not a fresh automated one)

Two things were tried and rejected:

- **Playwright's own bundled Chromium** gets stuck in an infinite Cloudflare
  "Verifying you are human" loop. Its `--enable-automation` launch flags
  flag `navigator.webdriver`, which Cloudflare blocks outright.
- **A fresh, empty Brave profile** (no automation flags at all) *also* hangs
  forever on the same Cloudflare check — a brand new profile with no
  history/cookies is itself treated as suspicious on this Cloudflare config.

The fix: attach Playwright via Chrome DevTools Protocol (`connect_over_cdp`)
to your **actual daily-driver Brave**, launched normally (not by Playwright)
with `--remote-debugging-port=9333`. A real, trusted, already-logged-in
profile passes Cloudflare immediately. `run.sh` handles restarting Brave
with that flag automatically if it isn't already running with it (your tabs
restore after, since Brave has session restore on by default).

## Setup

```bash
python3 -m venv venv
./venv/bin/pip install -r requirements.txt
./venv/bin/python -m playwright install chromium
```

`playwright install chromium` is only used for its bundled tooling; the
actual browsing happens in your real Brave over CDP, not this Chromium.

## Usage

Run `run.sh` (or double-click a desktop launcher pointed at it). It prompts
for a `studio.tripo3d.ai` link, makes sure Brave is running with remote
debugging on your real profile, and downloads the model to `~/Desktop`. The
model must have actually finished generating (visible as a real 3D shape in
Tripo's viewer, not just the 2D reference image) before running it.

## Converting to other formats

STL has no texture/color support by design — it's geometry only. To get a
textured version, or to convert to another format (e.g. decimating polygon
count), open the `.stl` in Blender (File → Import) and export from there.

## Bugs found and fixed during development

1. **Wrong extraction target for this page/route.** An earlier version
   assumed a generic TresJS `<Context>` component (correct for
   `/3d-model/<id>` pages). Tripo's `/workspace/generate/<slug>` pages use a
   custom ECS engine instead — fixed by locating the mesh via
   `ViewerCanvas.props.engine.system.model.entityMesh[0].ref` directly.

2. **Corrupted/noisy textures**, back when this exported full PBR materials:
   canvas 2D `drawImage()`+`toBlob()` on 4096×4096 textures produced random
   static on this machine's non-conformant Vulkan/GPU driver. This entire
   class of bug is now moot — the STL export never touches textures.

3. **Index buffer componentType mismatch.** Three.js uses `Uint16Array`
   indices for small meshes and `Uint32Array` for large ones; an earlier
   glTF-exporting version hardcoded 32-bit, which would have corrupted the
   index buffer on any model under ~65k vertices. Also moot under the
   current STL export (STL has no indexed-accessor concept — indices are
   read directly from the live `Uint16Array`/`Uint32Array` with no format
   assumption baked into the output).

## Files

- `inject.js` — runs inside the Tripo page, does the actual extraction.
- `tripo_download.py` — Playwright driver: opens the link, waits for the
  model, runs `inject.js`, saves the download.
- `run.sh` — desktop-launcher entry point (Brave lifecycle + kdialog UI).
