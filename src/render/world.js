// Локация целиком: рельеф + геометрия трассы + окружение. Одна система строит разные трассы
// по параметрам env (небо, туман, свет, плотность объектов). При смене трассы всё освобождается.
import * as THREE from 'three';
import { buildTerrain, TrackGrid } from './terrain.js';
import { buildTrackGroup, disposeGroup } from './trackMesh.js';
import { buildScenery } from './scenery.js';

export class World {
  constructor(gfx) {
    this.gfx = gfx;
    this.group = null;
    this.track = null;
    this.scenery = null;
    this.heightAt = null;
  }

  // quality: { terrainCell, density }
  load(track, quality = {}) {
    this.unload();
    const env = track.def.env || {};
    const t0 = performance.now();
    const grid = (this.grid = new TrackGrid(track));
    const group = new THREE.Group();
    group.name = 'world';
    const terrain = buildTerrain(track, env, grid, { cell: quality.terrainCell ?? 10 });
    group.add(terrain.mesh);
    this.heightAt = terrain.heightAt;
    const trackGroup = buildTrackGroup(track, env, { heightAt: terrain.heightAt, rubber: track.racingLine?.offset });
    group.add(trackGroup);
    this.scenery = buildScenery(track, env, grid, terrain.heightAt, { density: quality.density ?? 1 });
    group.add(this.scenery.group);
    this.gfx.scene.add(group);
    this.gfx.setEnvironment(env);
    this.group = group;
    this.track = track;
    this.setStartLights = trackGroup.userData.setStartLights;
    console.info(`[airwheel] трасса «${track.name}» построена за ${Math.round(performance.now() - t0)} мс`);
  }

  update(camPos, lodScale) {
    this.scenery?.update(camPos, lodScale);
  }

  unload() {
    if (!this.group) return;
    disposeGroup(this.group);
    this.group = null;
    this.scenery = null;
    this.track = null;
  }
}
