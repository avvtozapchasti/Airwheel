// «Desert Canyon» — пустыня и каньон на закате: длинная прямая через пески, подъём в
// красный каньон, быстрые дуги с перепадами высот, связка медленных поворотов у скал.
import { turtle, keysAt } from './turtle.js';

const path = turtle([
  ['S', 770], //  0 прямая через пустыню
  ['L', 74, 45], //  1 «Мираж» — под тормоз в конце прямой
  ['S', 319], //  2
  ['L', 40, 200], //  3 быстрая дуга
  ['S', 299], //  4 подъём
  ['L', 49, 110], //  5 «Ворота каньона»
  ['S', 258], //  6 по каньону
  ['L', 31, 240], //  7 быстрая
  ['S', 267], //  8 к вершине
  ['L', 111, 30], //  9 «Красная скала» — медленный
  ['S', 116], // 10
  ['R', 92, 30], // 11 «Ущелье»
  ['S', 227], // 12 спуск
  ['L', 23, 90], // 13
  ['S', 191], // 14
  ['L', 86, 160], // 15 «Дюна» — длинная быстрая
  ['S', 177], // 16
  ['L', 38, 70], // 17 на прямую
]);

export default {
  id: 'desert',
  name: 'Desert Canyon',
  subtitle: 'Пустыня · каньон · закат',
  description: 'Длинная прямая через пески, подъём в красный каньон, быстрые дуги и перепады высот.',
  points: path,
  startOffset: 330,
  pit: { side: 'left', from: -280, to: 250 },
  width: keysAt(path, { 0: 15, 1: 14.5, 3: 14, 5: 13.5, 7: 13, 9: 13, 11: 13, 13: 13.5, 15: 14.5, 17: 15 }),
  height: keysAt(path, { 0: 0, 1: 0, 2: 3, 3: 6, 4: 11, 5: 15, 6: 19, 7: 22, 8: 26, 9: 28, 10: 26, 11: 22, 12: 15, 13: 10, 14: 6, 15: 3, 16: 1, 17: 0 }),
  bank: keysAt(path, { 0: 0, 3: 3.5, 4: 0, 7: 3, 8: 0, 15: 4, 16: 0 }),
  runoffSurface: 'sand',
  gravel: ['hairpin', 'turn90'],
  runoffLeft: keysAt(path, { 0: 10, 1: 8, 3: 9, 5: 6, 6: 4, 7: 5, 8: 4, 9: 5, 10: 3.5, 11: 6, 12: 5, 15: 9, 17: 9 }),
  runoffRight: keysAt(path, { 0: 12, 1: 12, 3: 7, 5: 7, 6: 4, 7: 6, 8: 4, 9: 9, 10: 3.5, 11: 4, 12: 5, 15: 8, 17: 8 }),
  corners: [
    { t: path.tMid[1], name: 'Мираж', type: 'turn90' },
    { t: path.tMid[5], name: 'Ворота каньона', type: 'turn' },
    { t: path.tMid[9], name: 'Красная скала', type: 'hairpin' },
    { t: path.tMid[11], name: 'Ущелье', type: 'turn90' },
    { t: path.tMid[17], name: 'Оазис', type: 'turn' },
  ],
  canyon: [path.tStart[6], path.tStart[13]], // участок между скальными стенами
  grandstands: [{ t: path.tStart[0] + 0.05, side: 'right', count: 3 }, { t: path.tMid[9], side: 'out', count: 1 }],
  env: {
    time: 'sunset',
    sky: { turbidity: 9, rayleigh: 2.2, mie: 0.014, mieG: 0.88, elevation: 9, azimuth: 250 },
    sun: { color: 0xffb27a, intensity: 1.9 },
    hemi: { sky: 0xffd2a8, ground: 0x7a4a2c, intensity: 0.4 },
    fog: { color: 0xc98f6a, near: 700, far: 4200 },
    exposure: 0.68,
    envIntensity: 0.5,
    far: 5200,
    ground: 'desert',
    wall: 'armco',
    terrain: { amp: 18, scale: 1 / 260, rise: 0.05, riseMax: 40, color: 0xe7b58a, rocky: true, margin: 1100 },
    bloom: { strength: 0.22, radius: 0.4, threshold: 3.0 },
    scenery: {
      canyon: { mesas: 26, walls: true, cacti: 420, boulders: 220 },
      rocks: { count: 160, far: 260, tint: 0xc0704a },
      peaks: { count: 12, dist: [2400, 3600], height: [180, 420], snow: false, color: 0xa9583a },
    },
  },
};
