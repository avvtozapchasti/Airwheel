// «Sakura Touge» — японская горная дорога ранним вечером в тумане: узкий серпантин со
// шпильками, подъём на перевал, лес кедров, бамбук и цветущая сакура, тории и каменные фонари.
import { turtle, keysAt } from './turtle.js';

const path = turtle([
  ['S', 414], //  0 прямая в долине
  ['L', 91, 30], //  1 «Тории» — под тормоз
  ['S', 134], //  2
  ['R', 33, 60], //  3 подъём
  ['S', 158], //  4
  ['R', 81, 18], //  5 ШПИЛЬКА «Сакура»
  ['S', 46], //  6
  ['R', 63, 18], //  7
  ['S', 196], //  8
  ['L', 29, 55], //  9
  ['S', 174], // 10
  ['L', 88, 18], // 11 ШПИЛЬКА «Бамбук»
  ['S', 42], // 12
  ['L', 58, 18], // 13
  ['S', 238], // 14 к перевалу
  ['L', 15, 90], // 15
  ['S', 267], // 16 перевал
  ['L', 69, 32], // 17 «Фонари»
  ['S', 192], // 18 спуск
  ['L', 27, 110], // 19
  ['S', 229], // 20
  ['L', 111, 20], // 21 ШПИЛЬКА «Кедр»
  ['S', 43], // 22
  ['R', 76, 20], // 23
  ['S', 180], // 24
  ['R', 23, 45], // 25
  ['S', 161], // 26
  ['L', 20, 80], // 27
  ['S', 47], // 28
  ['L', 128, 36], // 29 «Долина» — на прямую
]);

export default {
  id: 'sakura',
  name: 'Sakura Touge',
  subtitle: 'Горы · вечер · туман и сакура',
  description: 'Узкий серпантин со шпильками и перевалом, кедры, бамбук, сакура, тории и каменные фонари.',
  points: path,
  startOffset: 230,
  pit: { side: 'left', from: -190, to: 130 },
  minWidth: 9,
  maxWidth: 12,
  width: keysAt(path, { 0: 11.5, 1: 11, 2: 10.5, 5: 10, 8: 9.5, 11: 10, 14: 9.5, 16: 9.5, 17: 10, 20: 9.5, 21: 10, 24: 10, 27: 10.5, 29: 11, 28: 11 }),
  height: keysAt(path, { 0: 0, 1: 1, 2: 3, 3: 6, 4: 10, 5: 14, 7: 17, 8: 21, 10: 26, 11: 30, 13: 33, 14: 37, 16: 42, 17: 41, 18: 37, 20: 30, 21: 26, 23: 21, 24: 15, 26: 9, 28: 4, 29: 1 }),
  bank: keysAt(path, { 0: 0, 5: 4, 6: 0, 11: -4, 12: 0, 21: -4, 22: 0 }),
  kerbWidth: 0.9,
  kerbRadius: 230,
  lineMargin: 1.6,
  runoffLeft: keysAt(path, { 0: 6, 1: 5, 2: 2.5, 5: 4, 8: 2, 11: 3.5, 14: 2, 16: 2, 17: 3.5, 20: 2, 21: 3.5, 24: 2.5, 29: 6 }),
  runoffRight: keysAt(path, { 0: 6, 1: 6, 2: 2.5, 5: 3, 8: 2, 11: 4, 14: 2, 16: 2, 17: 4, 20: 2, 21: 3, 24: 2.5, 29: 5 }),
  corners: [
    { t: path.tMid[1], name: 'Тории', type: 'turn90' },
    { t: path.tMid[5], name: 'Шпилька «Сакура»', type: 'hairpin' },
    { t: path.tMid[11], name: 'Шпилька «Бамбук»', type: 'hairpin' },
    { t: path.tMid[17], name: 'Фонари', type: 'turn90' },
    { t: path.tMid[21], name: 'Шпилька «Кедр»', type: 'hairpin' },
    { t: path.tMid[29], name: 'Долина', type: 'turn90' },
  ],
  grandstands: [{ t: path.tStart[0] + 0.03, side: 'right', count: 2 }],
  env: {
    time: 'dusk',
    sky: { turbidity: 6, rayleigh: 3, mie: 0.01, mieG: 0.86, elevation: 3, azimuth: 290 },
    sun: { color: 0xff9fb0, intensity: 1.4 },
    hemi: { sky: 0xc7b4e0, ground: 0x2c3328, intensity: 0.55 },
    fog: { color: 0xb3a4c4, near: 90, far: 900 },
    exposure: 0.85,
    envIntensity: 0.5,
    far: 2600,
    ground: 'grass',
    wall: 'armco',
    terrain: { rise: 0.35, riseMax: 160, amp: 34, scale: 1 / 300, margin: 900, color: 0xd6dcc8 },
    bloom: { strength: 0.3, radius: 0.45, threshold: 1.6 },
    scenery: {
      japan: { sakura: 520, bamboo: 900, torii: 6, lanterns: 70 },
      trees: { kind: 'spruce', count: 5200, near: 6, far: 520, scale: 1.25 },
      rocks: { count: 120 },
      peaks: { count: 14, dist: [1700, 2600], height: [320, 700], snow: false, color: 0x4f5a66 },
    },
  },
};
