// Локация целиком: рельеф + геометрия трассы + окружение. Одна система строит разные трассы
// по параметрам env (небо, туман, свет, плотность объектов). При смене трассы всё освобождается.
// Ночью: настоящие точечные огни только у ближайших фонарей (пул фиксированного размера,
// чтобы шейдеры не перекомпилировались), остальные — emissive + bloom; фара игрока — SpotLight,
// у ботов — светящиеся фары и пятна света на дороге.
import * as THREE from 'three';
import { buildTerrain, TrackGrid } from './terrain.js';
import { buildTrackGroup, disposeGroup } from './trackMesh.js';
import { buildScenery } from './scenery.js';
import { buildPitLane } from './pitlane.js';
import * as TX from './textures.js';

const POOL = 6; // максимум настоящих точечных огней

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
    this.realLights = 6;
    // пул точечных огней живёт всё время (число источников не меняется)
    for (let k = 0; k < POOL; k++) {
      const l = new THREE.PointLight(0xffd0a0, 0, 30, 1.7);
      l.userData.target = 0;
      gfx.scene.add(l);
      this.pool.push(l);
    }
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
    this.gfx.scene.add(this.botPools);
    for (const l of this.pool) {
      l.intensity = 0;
      l.userData.target = 0;
      l.userData.spot = null;
    }
    console.info(`[airwheel] трасса «${track.name}» построена за ${Math.round(performance.now() - t0)} мс, огней: ${this.lights.length}`);
  }

  setRealLights(n) {
    this.realLights = Math.max(0, Math.min(POOL, n));
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
  update(camPos, { lodScale = 1, dt = 0, focus = null, bots = null, pit = null } = {}) {
    this.scenery?.update(camPos, lodScale, dt);
    if (this.pit && pit) this.pit.update(dt, pit);
    this.headlight.intensity = this.night && this.headlightOwner?.root.visible ? 110 : 0;
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

  unload() {
    if (!this.group) return;
    this.botPools.removeFromParent();
    disposeGroup(this.group);
    this.group = null;
    this.scenery = null;
    this.pit = null;
    this.track = null;
    this.lights = [];
  }
}
