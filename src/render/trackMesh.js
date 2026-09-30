// Меш трассы из выборки сплайна: дорога с UV и нормалями.
import * as THREE from 'three';
import * as TX from './textures.js';

const ROAD_COLS = 8; // поперечных делений дороги

// Лента вдоль трассы: для каждой выборки i — ряд вершин по смещениям offsets(i) → [d...].
// yFn(i, d) — высота, uFn(col) — координата u. Замыкается в кольцо.
export function ribbon(track, offsetsFn, { yFn, uLen = 20, uAcross = null, step = 1, colorFn = null } = {}) {
  const n = track.n;
  const rows = Math.ceil(n / step);
  const cols = offsetsFn(0).length;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const col = colorFn ? new Float32Array(rows * cols * 3) : null;
  // число повторов текстуры вдоль круга — целое, чтобы шов совпал
  const reps = Math.max(1, Math.round(track.length / uLen));
  for (let r = 0; r < rows; r++) {
    const i = Math.min(n - 1, r * step);
    const offs = offsetsFn(i);
    for (let c = 0; c < cols; c++) {
      const d = offs[c];
      const k = (r * cols + c) * 3;
      pos[k] = track.x[i] + track.nx[i] * d;
      pos[k + 1] = yFn ? yFn(i, d, c) : track.heightAt(i, 0, d);
      pos[k + 2] = track.z[i] + track.nz[i] * d;
      uv[(r * cols + c) * 2] = uAcross ? uAcross(c, d, i) : c / (cols - 1);
      uv[(r * cols + c) * 2 + 1] = (i / n) * reps;
      if (col) {
        const [cr, cg, cb] = colorFn(i, d, c);
        col[k] = cr;
        col[k + 1] = cg;
        col[k + 2] = cb;
      }
    }
  }
  // индексы: последний ряд соединяется с первым; у шва v продолжаем до reps через дубль ряда
  const idx = [];
  for (let r = 0; r < rows; r++) {
    const r2 = (r + 1) % rows;
    if (r2 === 0) continue; // шов закроем отдельным рядом
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = r2 * cols + c;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // дополнительный ряд-копия первого с v = reps
  const g = new THREE.BufferGeometry();
  const extra = cols;
  const pos2 = new Float32Array(pos.length + extra * 3);
  pos2.set(pos);
  pos2.set(pos.subarray(0, cols * 3), pos.length);
  const uv2 = new Float32Array(uv.length + extra * 2);
  uv2.set(uv);
  for (let c = 0; c < cols; c++) {
    uv2[uv.length + c * 2] = uv[c * 2];
    uv2[uv.length + c * 2 + 1] = reps;
  }
  const last = rows - 1, dup = rows;
  for (let c = 0; c < cols - 1; c++) {
    const a = last * cols + c, b = dup * cols + c;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
  if (col) {
    const col2 = new Float32Array(col.length + extra * 3);
    col2.set(col);
    col2.set(col.subarray(0, cols * 3), col.length);
    g.setAttribute('color', new THREE.BufferAttribute(col2, 3));
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildRoad(track, { wet = false } = {}) {
  const tex = TX.asphalt({ wet });
  const geo = ribbon(
    track,
    (i) => {
      const hw = track.hw[i];
      const out = [];
      for (let c = 0; c <= ROAD_COLS; c++) out.push(hw - (2 * hw * c) / ROAD_COLS);
      return out;
    },
    { uLen: 16 },
  );
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    roughnessMap: tex.roughnessMap,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(0.6, 0.6),
    envMapIntensity: wet ? 1.4 : 0.5,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'road';
  return mesh;
}

// Освобождение GPU-ресурсов группы (при смене трассы).
export function disposeGroup(group) {
  group.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) m.dispose();
    if (o.isInstancedMesh) o.dispose();
  });
  group.removeFromParent();
}
