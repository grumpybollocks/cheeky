# tripo-downloader

Downloads the actual 3D model from a `studio.tripo3d.ai` model page as a
plain `.stl` (pure geometry — vertices and triangles, no color/texture/
material), without needing Tripo's paywalled "Export" button.

## Usage

Run `run.sh` (or double-click a desktop launcher pointed at it). It prompts
for a `studio.tripo3d.ai` link, makes sure Brave is running with remote
debugging on your real profile, and downloads the model to your Desktop.
The model must have actually finished generating (visible as a real 3D
shape in Tripo's viewer, not just the 2D reference image) before running it.

## Setup (needed once per machine, e.g. on Tria)

```bash
git clone git@github.com:grumpybollocks/cheeky.git
cd cheeky
```

Then double-click `install.sh` in your file manager and choose **Execute**
(KDE/Dolphin asks this by default for a script with the executable bit set —
that bit is preserved by git). It creates the Python virtual environment,
installs dependencies, installs Playwright's bundled Chromium (used only for
its tooling — actual browsing happens in your real Brave over CDP, not this
Chromium), and puts a **Tripo3D Downloader** icon on your Desktop, all in one
step. Nothing else is machine-specific — see "Why this is portable" below
for exactly what was checked.

Re-running `install.sh` later is safe (e.g. after a `git pull`) — it skips
recreating the virtual environment if one already exists, and just
refreshes everything else.

## How it works

Tripo's viewer is a Nuxt/Vue app running a custom ECS-based 3D engine (not
plain TresJS, despite the canvas element's `data-tres` attribute). The
already-generated, already-decoded mesh lives in memory as a real
`THREE.Mesh`, reachable at:

```
ViewerCanvas (Vue component) .props.engine.system.model.entityMesh[N].ref
```

`inject.js` walks the live Vue component tree to find that mesh (or
meshes — see bug #4 below), reads the raw geometry (position + index,
already dequantized by the browser's own loader), computes a proper face
normal per triangle, and assembles a standard binary STL in memory, then
triggers a normal browser download.

`tripo_download.py` drives this via Playwright, attached over CDP to a real,
already-logged-in Brave window (see "Why a real browser" below) — it opens
the link, waits for the mesh to finish loading, runs `inject.js`, and saves
the resulting download.

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

## Why this is portable to another machine

Everything machine-specific is resolved at runtime, not hardcoded:

- Brave binary: `command -v brave` (falls back to `brave-browser`)
- Brave profile: `$HOME/.config/BraveSoftware/Brave-Browser`
- Download folder: `xdg-user-dir DESKTOP` (falls back to `~/Desktop`,
  creates it if missing)
- Dialogs: `kdialog` if present, else `zenity`
- Script paths: relative to `run.sh`'s own location (`cd "$(dirname "$0")"`)

The one thing that *isn't* portable across a Tripo redesign is the internal
component/property names (`ViewerCanvas`, `entityMesh`, etc.) — see the
Limitations section.

## Verified test results

Tested against two different models, both different URL shapes, on
2026-09-23:

| Model | URL shape | Triangles | Result |
|---|---|---|---|
| "lips on rectangular block" | `/workspace/generate/<slug>-<uuid>` | 1,959,453 | Valid STL, header/size match, all sampled normals unit-length |
| Fox statue | `/3d-model/<uuid>` (no slug) | 2,113,492 | Valid STL, header/size match, sane bounding box; 18/100,000 sampled triangles had a zero-length normal — expected/benign (real mesh data has a small number of degenerate/duplicate-vertex triangles; not an extraction bug, doesn't affect Blender or slicers) |

Both confirm: works across the two known Tripo URL formats, across
different geometry sizes, with filenames correctly adapting to whichever
slug (or lack of one) the URL has.

## Limitations (things that would need a fix if they change)

- **If Tripo redesigns their frontend**, the component/property path
  (`ViewerCanvas.props.engine.system.model.entityMesh`) could change and
  break extraction. Can't be pre-emptively fixed — but `inject.js` fails
  with a clear, specific error message at each step (Vue app not found →
  page component not found → ViewerCanvas not found → no mesh entities →
  no valid geometry) rather than silently producing a broken file.
- **Geometry only** — no color/texture/material. That's intentional (see
  bug history below), not a limitation to fix.
- **Requires your real Brave**, not a fresh/incognito one — see above.

## Bug history (chronological, for future reference)

1. **Wrong extraction target for `/workspace/generate/` pages.** The
   original version (adapted from a public gist written for
   `/3d-model/<id>` pages) assumed a generic TresJS `<Context>` component.
   Tripo's ECS engine doesn't expose one — fixed by locating the mesh via
   `ViewerCanvas.props.engine.system.model.entityMesh[0].ref` directly,
   discovered by walking the live Vue component tree in the browser and
   inspecting real runtime objects rather than guessing.

2. **Corrupted/noisy textures**, from when this exported full PBR
   materials (before switching to geometry-only STL): canvas 2D
   `drawImage()`+`toBlob()` on 4096×4096 textures produced random static,
   traced to this machine's non-conformant Vulkan/GPU driver. Fixed at the
   time with `willReadFrequently: true`; moot now since STL export never
   touches textures.

3. **Missing tangent data caused a flat/wrong-looking region** on one
   whole side of a model, also from the GLB-with-textures era: the live
   geometry carried an explicit per-vertex `TANGENT` attribute that wasn't
   being exported, so importers had to guess their own (and guessed wrong
   at a mirrored UV seam). Moot now under geometry-only STL export.

4. **Multi-part models would silently lose data.** Tripo's "Generate in
   Parts" option produces multiple separate mesh entities; the code only
   ever read `entityMesh[0]`. Fixed by combining every entity, each
   transformed into world space via its own `matrixWorld` — verified
   byte-identical output on the single-mesh test model (confirms the
   transform is a correct no-op when there's only one part).

5. **Filenames could silently fail to save.** Built directly from the URL
   slug, which is derived from free-text AI prompts — could contain unsafe
   characters or exceed Linux's 255-byte filename limit. Fixed by
   sanitizing to `[a-zA-Z0-9_-]` and capping length, keeping the *end* of
   the string (where Tripo puts the UUID) rather than the start.

6. **Hardcoded paths broke portability to a second machine.** Brave binary
   path, profile path, and download folder were all Desktop-specific.
   Fixed by resolving all three at runtime (see "Why this is portable").

7. **`kdialog`-only UI** would hard-fail if a machine doesn't have it
   installed. Added a `zenity` fallback.

8. **Index buffer componentType mismatch** (from the GLB era): Three.js
   uses 16-bit indices for small meshes, 32-bit for large ones; the export
   hardcoded 32-bit, which would corrupt the index buffer on any model
   under ~65k vertices. Moot now — STL has no indexed-accessor concept, so
   this class of bug can't recur under the current format.

## Files

- `inject.js` — runs inside the Tripo page, does the actual extraction.
- `tripo_download.py` — Playwright driver: opens the link, waits for the
  model, runs `inject.js`, saves the download.
- `run.sh` — desktop-launcher entry point (Brave lifecycle + dialog UI).
