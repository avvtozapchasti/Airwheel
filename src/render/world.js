// Локация целиком: рельеф + геометрия трассы + окружение. Одна система строит разные трассы
// по параметрам env (небо, туман, свет, плотность объектов). При смене трассы всё освобождается.
// Ночью: настоящие точечные огни только у ближайших фонарей и экранов (пул: 10 / 5 / 2 по
// пресету графики; размер меняется только при смене пресета — одна перекомпиляция шейдеров),
// остальные — emissive + bloom; фара игрока — SpotLight, у соперников — светящиеся фары,
// пятна света на дороге, блики фар и стоп-сигналов (Points) и отражения стоп-сигналов
// на асфальте (сильнее на мокром).
import * as THREE from 'three';
import { buildTerrain, TrackGrid } from './terrain.js';
import { buildTrackGroup, disposeGroup } from './trackMesh.js';
import { buildScenery } from './scenery.js';
import { buildPitLane } from './pitlane.js';
import { buildTrackside } from './trackside.js';
import { CITY_U, glowPointsMaterial } from './city.js';
import { WET } from './rain.js';
import * as TX from './textures.js';

const POOL_MAX = 12; // максимум настоящих точечных огней
const CARS_MAX = 24; // машин с бликами фар

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color(), _up = new THREE.Vector3(0, 1, 0);

export class World {
  constructor(gfx) {
    this.gfx = gfx;
    this.group = null;
    this.track = null;
    this.scenery = null;
    this.heightAt = null;
    this.lights = [];
    this.pool = [];
    this.poolT = 0;
    this.night = false;
    this.realLights = 0;
    this.setRealLights(6);
    // фара игрока
    this.headlight = new THREE.SpotLight(0xf4f7ff, 0, 95, 0.42, 0.55, 1.1);
    this.headlight.position.set(0, 0.8, 1.9);
    this.headlight.target.position.set(0, 0, 22);
    this.headlightOwner = null;
    // пятна фар ботов на асфальте
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    this.botPools = new THREE.InstancedMesh(
      plane,
      new THREE.MeshBasicMaterial({ map: TX.glow(), color: new THREE.Color(0xdfe8ff).multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }),
      16,
    );
    this.botPools.count = 0;
    this.botPools.frustumCulled = false;
    this.botPools.renderOrder = 2;
    // блики фар и стоп-сигналов: 4 точки на машину, позиции обновляются каждый кадр
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CARS_MAX * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(CARS_MAX * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    fg.setAttribute('blink', new THREE.BufferAttribute(new Float32Array(CARS_MAX * 4 * 4), 4).setUsage(THREE.DynamicDrawUsage));
    this.flares = new THREE.Points(fg, glowPointsMaterial({ streak: 1, maxPx: 72 }));
    this.flares.frustumCulled = false;
    this.flares.renderOrder = 3;
    fg.setDrawRange(0, 0);
    // отражения стоп-сигналов на асфальте: вытянутое красное пятно за машиной
    this.brakeRefl = new THREE.InstancedMesh(
      plane,
      new THREE.MeshBasicMaterial({ map: TX.glow(), color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, toneMapped: false }),
      CARS_MAX,
    );
    this.brakeRefl.setColorAt(0, new THREE.Color());
    this.brakeRefl.count = 0;
    this.brakeRefl.frustumCulled = false;
    this.brakeRefl.renderOrder = 2;
  }

  // quality: { terrainCell, density, realLights }
  load(track, quality = {}) {
    this.unload();
    const env = track.def.env || {};
    const t0 = performance.now();
    const grid = (this.grid = new TrackGrid(track));
    const group = new THREE.Group();
    group.name = 'world';
    const terrain = buildTerrain(track, env, grid, { cell: env.terrain?.cell ?? quality.terrainCell ?? 10 });
    group.add(terrain.mesh);
    this.heightAt = terrain.heightAt;
    const trackGroup = buildTrackGroup(track, env, { heightAt: terrain.heightAt, rubber: track.racingLine?.offset });
    group.add(trackGroup);
    this.trackside = buildTrackside(track, env, { heightAt: terrain.heightAt, grid, night: env.time === 'night' || env.time === 'dusk' });
    group.add(this.trackside.group);
    this.scenery = buildScenery(track, env, grid, terrain.heightAt, { density: quality.density ?? 1, seaAt: terrain.seaAt });
    group.add(this.scenery.group);
    this.pit = track.pit ? buildPitLane(track, env) : null;
    if (this.pit) group.add(this.pit.group);
    this.gfx.scene.add(group);
    this.gfx.setEnvironment(env);
    this.group = group;
    this.track = track;
    this.env = env;
    this.night = env.time === 'night' || env.time === 'dusk'; // в сумерках — фары и фонари
    this.lights = [...(trackGroup.userData.lights || []), ...(this.scenery.lights || []), ...(this.pit?.lights || [])];
    this.setStartLights = trackGroup.userData.setStartLights;
    this.gfx.scene.add(this.botPools, this.flares, this.brakeRefl);
    for (const l of this.pool) {
      l.intensity = 0;
      l.userData.target = 0;
      l.userData.spot = null;
    }
    console.info(`[airwheel] трасса «${track.name}» построена за ${Math.round(performance.now() - t0)} мс, огней: ${this.lights.length}`);
  }

  // Размер пула настоящих огней (пресет графики). Меняется редко: при смене числа источников
  // three.js перекомпилирует шейдеры освещённых материалов.
  // Табло-пилон у старта: rows — [{ code, color, player }] по местам.
  setStandings(rows) {
    this.trackside?.setStandings(rows);
  }

  setRealLights(n) {
    n = Math.max(0, Math.min(POOL_MAX, n | 0));
    if (n === this.realLights && this.pool.length === n) return;
    this.realLights = n;
    while (this.pool.length < n) {
      const l = new THREE.PointLight(0xffd0a0, 0, 30, 1.7);
      l.userData.target = 0;
      this.gfx.scene.add(l);
      this.pool.push(l);
    }
    while (this.pool.length > n) this.pool.pop().removeFromParent();
  }

  // Фара на машине игрока (ночью).
  attachHeadlight(model) {
    if (this.headlightOwner === model) return;
    this.headlight.removeFromParent();
    this.headlight.target.removeFromParent();
    model.root.add(this.headlight, this.headlight.target);
    this.headlightOwner = model;
  }

  // Каждый кадр: LOD, вода, огни у игрока, пятна фар ботов.
  // focus: { s, x, y, z } — позиция игрока (или камеры), bots: [{x, y, z, psi}]
  update(camPos, { lodScale = 1, dt = 0, focus = null, bots = null, pit = null, cars = null } = {}) {
    this.scenery?.update(camPos, lodScale, dt);
    // размер точечных огней (пиксели на метр): высота буфера / (2·tg(fov/2))
    const cam = this.gfx.camera;
    CITY_U.uScale.value = this.gfx.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    if (this.pit && pit) this.pit.update(dt, pit);
    this.headlight.intensity = this.night && this.headlightOwner?.root.visible ? 110 : 0;
    this.updateCarLights(cars);
    if (!this.night || !this.track) {
      for (const l of this.pool) l.intensity = 0;
      this.botPools.count = 0;
      return;
    }
    // выбрать ближайшие фонари впереди (по дистанции трассы), раз в 0.2 с
    this.poolT -= dt;
    if (this.poolT <= 0 && focus) {
      this.poolT = 0.2;
      const tr = this.track;
      const ranked = [];
      for (const L of this.lights) {
        const ds = tr.deltaS(focus.s, L.s);
        if (ds < -25 || ds > 140) continue;
        ranked.push({ L, score: Math.abs(ds - 30) });
      }
      ranked.sort((a, b) => a.score - b.score);
      const chosen = ranked.slice(0, this.realLights).map((r) => r.L);
      // оставляем уже горящие на своих местах, новые — на свободные
      for (const l of this.pool) if (l.userData.spot && !chosen.includes(l.userData.spot)) l.userData.target = 0;
      for (const L of chosen) {
        if (this.pool.some((l) => l.userData.spot === L && l.userData.target > 0)) continue;
        const free = this.pool.find((l) => l.userData.target === 0 && l.intensity < 1);
        if (!free) break;
        free.userData.spot = L;
        free.userData.target = 14 * (L.power ?? 1);
        free.position.set(L.x, L.y, L.z);
        free.color.set(L.color ?? 0xffd0a0);
      }
    }
    for (const l of this.pool) {
      l.intensity += (l.userData.target - l.intensity) * Math.min(1, dt * 6);
      if (l.intensity < 0.05 && l.userData.target === 0) l.intensity = 0;
    }
    // пятна фар ботов: впереди каждой машины на асфальте
    if (bots) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(3.2, 1, 9);
      const up = new THREE.Vector3(0, 1, 0);
      let k = 0;
      for (const b of bots) {
        if (k >= 16) break;
        q.setFromAxisAngle(up, b.psi);
        p.set(b.x + Math.sin(b.psi) * 7.5, b.y + 0.04, b.z + Math.cos(b.psi) * 7.5);
        m.compose(p, q, s);
        this.botPools.setMatrixAt(k++, m);
      }
      this.botPools.count = k;
      this.botPools.instanceMatrix.needsUpdate = true;
    }
  }

  // Блики фар/стоп-сигналов и отражения стоп-сигналов на асфальте.
  // cars: [{ x, y, z, psi, brake, f1, dims }] — положение моделей (уже интерполированное).
  updateCarLights(cars) {
    const pos = this.flares.geometry.attributes.position, col = this.flares.geometry.attributes.color, bl = this.flares.geometry.attributes.blink;
    let n = 0, k = 0;
    const wet = WET.uWet.value;
    const m = _m, q = _q, p = _p, sc = _s;
    if (cars && this.track) {
      for (const c of cars) {
        if (k >= CARS_MAX) break;
        const sn = Math.sin(c.psi), cs = Math.cos(c.psi);
        const put = (lx, ly, lz, r, g, b, size) => {
          pos.setXYZ(n, c.x + cs * lx + sn * lz, c.y + ly, c.z - sn * lx + cs * lz);
          col.setXYZ(n, r, g, b);
          bl.setXYZW(n, 0, 0, 1, size);
          n++;
        };
        const brake = c.brake ? 1 : 0;
        const L = c.dims?.length ?? 4.6;
        if (this.night) {
          // фары (у F1 фар нет)
          if (!c.f1) for (const sx of [-0.6, 0.6]) put(sx, 0.62, L / 2 - 0.12, 1.8, 1.9, 2.2, 1.2);
          const tz = c.f1 ? -L / 2 - 0.2 : -L / 2 + 0.02, tx = c.f1 ? 0.52 : 0.7;
          // своя машина — у самой камеры: блики меньше
          const tb = (0.55 + brake * 1.5) * (c.player ? 0.5 : 1);
          for (const sx of [-tx, tx]) put(sx, 0.8, tz, tb * 1.6, tb * 0.12, tb * 0.08, (0.3 + brake * 0.2) * (c.player ? 0.6 : 1));
        }
        // отражение стоп-сигналов: ночью всегда (тускло, на мокром ярче), днём — только на мокром
        const refl = (this.night ? (0.14 + brake * 0.4) * (0.3 + wet * 0.9) : brake * 0.3 * wet) * (c.player ? 0.4 : 1);
        if (refl > 0.02) {
          q.setFromAxisAngle(_up, c.psi);
          p.set(c.x - sn * (L / 2 + 1.6 + wet * 1.2), c.y + 0.04, c.z - cs * (L / 2 + 1.6 + wet * 1.2));
          m.compose(p, q, sc.set(2.2, 1, 3 + wet * 3));
          this.brakeRefl.setMatrixAt(k, m);
          this.brakeRefl.setColorAt(k, _c.setRGB(refl * 0.9, refl * 0.06, refl * 0.04));
          k++;
        }
      }
    }
    this.flares.geometry.setDrawRange(0, n);
    if (n) {
      pos.needsUpdate = col.needsUpdate = bl.needsUpdate = true;
    }
    this.brakeRefl.count = k;
    if (k) {
      this.brakeRefl.instanceMatrix.needsUpdate = true;
      this.brakeRefl.instanceColor.needsUpdate = true;
    }
  }

  unload() {
    if (!this.group) return;
    this.botPools.removeFromParent();
    this.flares.removeFromParent();
    this.brakeRefl.removeFromParent();
    disposeGroup(this.group);
    this.group = null;
    this.scenery = null;
    this.trackside = null;
    this.pit = null;
    this.track = null;
    this.lights = [];
  }
}
