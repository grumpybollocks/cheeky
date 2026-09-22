(function extractTripoSTL() {
  // ── 1. Locate the decoded THREE.Mesh straight from Tripo's own ECS engine ──
  const appEl = document.querySelector('[data-v-app]') || document.querySelector('#__nuxt');
  if (!appEl?.__vue_app__) throw new Error('Vue app not found.');
  const vueApp = appEl.__vue_app__;
  const router = vueApp.config?.globalProperties?.$router;
  const matched = router?.currentRoute?.value?.matched?.[0];
  const pageInternal = matched?.instances?.default?._;
  if (!pageInternal) throw new Error('Page component instance not found.');

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
  if (!viewerCanvas) throw new Error('ViewerCanvas component not found.');
  const modelSystem = viewerCanvas.props?.engine?.system?.model;
  const meshEntity = modelSystem?.entityMesh?.[0];
  const modelMesh = meshEntity?.ref;
  if (!modelMesh?.isMesh) throw new Error('Decoded mesh not found — is the model finished generating?');

  console.log('[tripo-extract] Mesh found:', modelMesh.name);

  // ── 2. Pure geometry only — no UV, no tangent, no material, no color ──────
  const geo = modelMesh.geometry;
  const positions = geo.attributes.position.array;
  const indices = geo.index?.array ?? null;
  const triCount = indices ? indices.length / 3 : positions.length / 9;
  console.log(`[tripo-extract] ${positions.length / 3} vertices, ${triCount} triangles`);

  // ── 3. Build binary STL (face-normal computed per triangle, not sourced
  //      from the mesh — STL has no use for shading/vertex normals) ────────
  const headerSize = 80;
  const bytesPerTri = 50; // 12 (normal) + 36 (3 verts) + 2 (attr byte count)
  const totalSize = headerSize + 4 + triCount * bytesPerTri;

  const buf = new ArrayBuffer(totalSize);
  const dv = new DataView(buf);
  let off = headerSize;
  dv.setUint32(off, triCount, true); off += 4;

  const vA = new Float64Array(3), vB = new Float64Array(3), vC = new Float64Array(3);

  function getVertex(idx, out) {
    out[0] = positions[idx * 3];
    out[1] = positions[idx * 3 + 1];
    out[2] = positions[idx * 3 + 2];
  }

  for (let t = 0; t < triCount; t++) {
    let ia, ib, ic;
    if (indices) {
      ia = indices[t * 3]; ib = indices[t * 3 + 1]; ic = indices[t * 3 + 2];
    } else {
      ia = t * 3; ib = t * 3 + 1; ic = t * 3 + 2;
    }
    getVertex(ia, vA); getVertex(ib, vB); getVertex(ic, vC);

    const ux = vB[0] - vA[0], uy = vB[1] - vA[1], uz = vB[2] - vA[2];
    const wx = vC[0] - vA[0], wy = vC[1] - vA[1], wz = vC[2] - vA[2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;

    dv.setFloat32(off, nx, true); off += 4;
    dv.setFloat32(off, ny, true); off += 4;
    dv.setFloat32(off, nz, true); off += 4;
    for (const v of [vA, vB, vC]) {
      dv.setFloat32(off, v[0], true); off += 4;
      dv.setFloat32(off, v[1], true); off += 4;
      dv.setFloat32(off, v[2], true); off += 4;
    }
    dv.setUint16(off, 0, true); off += 2;
  }

  const fileMB = (totalSize / 1024 / 1024).toFixed(2);
  console.log(`[tripo-extract] STL assembled — ${fileMB} MB, ${triCount} triangles`);

  const modelId = window.location.pathname.split('/').filter(Boolean).pop() || 'model';
  const filename = `tripo_${modelId}.stl`;
  const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'model/stl' }));

  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);

  console.log(`[tripo-extract] Download triggered: ${filename} (${fileMB} MB)`);
  return { filename, fileMB, triangles: triCount };
})();
