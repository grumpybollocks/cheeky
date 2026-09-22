#!/usr/bin/env python3
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

SCRIPT_DIR = Path(__file__).parent
INJECT_JS = (SCRIPT_DIR / "inject.js").read_text()
DOWNLOAD_DIR = Path.home() / "Desktop"
CDP_URL = "http://127.0.0.1:9333"

FIND_MESH_JS = """
() => {
  const appEl = document.querySelector('[data-v-app]') || document.querySelector('#__nuxt');
  const vueApp = appEl?.__vue_app__;
  const router = vueApp?.config?.globalProperties?.$router;
  const matched = router?.currentRoute?.value?.matched?.[0];
  const pageInternal = matched?.instances?.default?._;
  if (!pageInternal) return false;

  function findByName(vnode, targetName, depth = 0) {
    if (!vnode || depth > 80) return null;
    if (vnode.component) {
      const inst = vnode.component;
      const name = inst.type?.name || inst.type?.__name || '';
      if (name === targetName) return inst;
      const found = findByName(inst.subTree, targetName, depth + 1);
      if (found) return found;
    }
    if (Array.isArray(vnode.children)) {
      for (const c of vnode.children) {
        if (c && typeof c === 'object') {
          const found = findByName(c, targetName, depth);
          if (found) return found;
        }
      }
    }
    return null;
  }

  const viewerCanvas = findByName(pageInternal.subTree, 'ViewerCanvas');
  const mesh = viewerCanvas?.props?.engine?.system?.model?.entityMesh?.[0]?.ref;
  return !!mesh?.isMesh && !!mesh.geometry?.attributes?.position;
}
"""


def main():
    if len(sys.argv) < 2:
        print("Usage: tripo_download.py <tripo3d-url>")
        sys.exit(1)
    url = sys.argv[1]

    with sync_playwright() as p:
        browser = p.chromium.connect_over_cdp(CDP_URL)
        if not browser.contexts:
            print("Brave has no open windows to attach to — open a window first.")
            sys.exit(1)
        context = browser.contexts[0]
        page = context.new_page()
        page.goto(url, wait_until="load")

        print("Waiting for the model to finish loading (up to 5 minutes — log in / open the model if needed)...")
        deadline = time.time() + 300
        ready = False
        while time.time() < deadline:
            if page.evaluate(FIND_MESH_JS):
                ready = True
                break
            time.sleep(2)

        if not ready:
            print("Timed out — the decoded mesh never appeared. Is the model actually generated on this page?")
            sys.exit(1)

        time.sleep(2)  # let textures finish attaching

        print("Extracting model and triggering download...")
        with page.expect_download(timeout=120000) as download_info:
            page.evaluate(INJECT_JS)
        download = download_info.value

        dest = DOWNLOAD_DIR / download.suggested_filename
        download.save_as(str(dest))
        print(f"Saved: {dest}")
        page.close()


if __name__ == "__main__":
    main()
