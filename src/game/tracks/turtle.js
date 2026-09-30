// Описание трассы «как едешь»: прямые и дуги → контрольные точки для CatmullRom.
//   ['S', 300]            — прямая 300 м
//   ['L', 90, 40]         — поворот налево на 90° радиусом 40 м
//   ['R', 180, 16]        — шпилька направо
// Сумма углов должна давать ±360°. Остаточная невязка по положению (обычно десятки метров)
// плавно распределяется по всей длине, так что сплайн замыкается без излома.

export function turtle(cmds, { start = [0, 0], heading = 0, straightStep = 40, arcStepDeg = 12 } = {}) {
  let x = start[0], z = start[1], th = (heading * Math.PI) / 180;
  const pts = [[x, z]];
  const dist = [0];
  const marks = []; // s начала каждой команды
  let s = 0;
  const push = (nx, nz) => {
    s += Math.hypot(nx - x, nz - z);
    x = nx;
    z = nz;
    pts.push([x, z]);
    dist.push(s);
  };
  for (const c of cmds) {
    marks.push(s);
    if (c[0] === 'S') {
      const n = Math.max(1, Math.round(c[1] / straightStep));
      const step = c[1] / n;
      for (let k = 0; k < n; k++) push(x + Math.sin(th) * step, z + Math.cos(th) * step);
    } else {
      const sign = c[0] === 'L' ? 1 : -1;
      const ang = (c[1] * Math.PI) / 180;
      const r = c[2];
      const n = Math.max(2, Math.ceil(c[1] / arcStepDeg), Math.ceil((ang * r) / 30));
      // центр дуги — слева (L) или справа (R) от курса; левая нормаль = (cos θ, −sin θ)
      const cx = x + sign * Math.cos(th) * r;
      const cz = z - sign * Math.sin(th) * r;
      for (let k = 1; k <= n; k++) {
        const t = th + (sign * ang * k) / n;
        push(cx - sign * Math.cos(t) * r, cz + sign * Math.sin(t) * r);
      }
      th += sign * ang;
    }
  }
  // невязка замыкания: последняя точка должна совпасть с первой
  const ex = x - start[0], ez = z - start[1];
  const out = pts.map(([px, pz], i) => [px - (ex * dist[i]) / s, pz - (ez * dist[i]) / s]);
  out.pop(); // последняя совпадает с первой
  out.closure = Math.hypot(ex, ez);
  out.turn = (th * 180) / Math.PI - heading;
  // t (доля круга) начала и середины каждой команды — к ним привязываются профили и повороты
  out.tStart = marks.map((m) => m / s);
  out.tMid = marks.map((m, k) => ((m + (marks[k + 1] ?? s)) / 2) / s);
  return out;
}

// Ключи профиля по номерам команд: {3: 6, 5: 18} → [[t, 6], [t, 18]]. at = 'start' | 'mid'.
export function keysAt(path, map, at = 'mid') {
  const t = at === 'start' ? path.tStart : path.tMid;
  return Object.entries(map).map(([k, v]) => [t[+k], v]);
}
