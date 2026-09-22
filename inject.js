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
  const meshEntities = modelSystem?.entityMesh;
  if (!meshEntities || meshEntities.length < 1) {
    throw new Error('No mesh entities found — is the model finished generating?');
  }

  // Models generated "in parts" have multiple separate mesh entities — grab
  // all of them, not just the first, or multi-part models silently lose
  // everything but one piece.
  const meshes = [];
  for (const entity of meshEntities) {
    const mesh = entity?.ref;
    if (mesh?.isMesh && mesh.geometry?.attributes?.position?.array?.length) {
      mesh.updateMatrixWorld(true);
      meshes.push(mesh);
    }
  }
  if (meshes.length < 1) {
    throw new Error('No valid mesh geometry found among entities — geometry not ready or Tripo changed something.');
  }
  console.log(`[tripo-extract] ${meshes.length} mesh part(s) found`);

  // ── 2. Pure geometry only — no UV, no tangent, no material, no color ──────
  // Combine all parts into one position/index buffer, each transformed into
  // world space via its own matrixWorld (a no-op for the common single-mesh
  // case, since that matrix is identity).
  let totalVerts = 0, totalIdx = 0;
  for (const m of meshes) {
    const vCount = m.geometry.attributes.position.array.length / 3;
    totalVerts += vCount;
    totalIdx += m.geometry.index?.array?.length ?? vCount;
  }

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalIdx);
  let vOff = 0, iOff = 0, vertBase = 0;

  for (const m of meshes) {
    const pos = m.geometry.attributes.position.array;
    const vCount = pos.length / 3;
    const me = m.matrixWorld.elements;
    for (let i = 0; i < vCount; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      positions[vOff++] = me[0] * x + me[4] * y + me[8]  * z + me[12];
      positions[vOff++] = me[1] * x + me[5] * y + me[9]  * z + me[13];
      positions[vOff++] = me[2] * x + me[6] * y + me[10] * z + me[14];
    }
    const idxArr = m.geometry.index?.array;
    if (idxArr) {
      for (let i = 0; i < idxArr.length; i++) indices[iOff++] = idxArr[i] + vertBase;
    } else {
      for (let i = 0; i < vCount; i++) indices[iOff++] = i + vertBase;
    }
    vertBase += vCount;
  }

  const triCount = indices.length / 3;
  if (triCount < 1) {
    throw new Error('Mesh has zero triangles — nothing to export.');
  }
  console.log(`[tripo-extract] ${totalVerts} vertices, ${triCount} triangles (combined)`);

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

  // Tripo slugs are derived from free-text prompts — can contain arbitrary
  // characters and be arbitrarily long. Sanitize and cap length so the
  // filename can't exceed the filesystem's limit (255 bytes on ext4) or
  // contain characters that break path handling (e.g. a literal "/").
  // Keep the END of the string, not the start — that's where Tripo puts the
  // UUID, which is what actually distinguishes one generation from another.
  const rawId = window.location.pathname.split('/').filter(Boolean).pop() || 'model';
  const modelId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-150) || 'model';
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
