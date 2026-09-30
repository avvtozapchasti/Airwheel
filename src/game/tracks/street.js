// «Street Night» — узкая городская трасса ночью в духе Баку/Монако/Джидды.
// Бетонные стены вплотную, туннель, шпилька 180°, повороты 90° под тормоз, узкий участок ~8 м
// в старом городе и длинная быстрая прямая вдоль набережной. Асфальт мокрый.
import { turtle, keysAt } from './turtle.js';

const path = turtle([
  ['S', 847], //  0 набережная — самая длинная прямая
  ['L', 90, 24], //  1 T1 — 90° налево после самой быстрой прямой
  ['S', 174], //  2
  ['R', 90, 20], //  3 квартал: 90° направо
  ['S', 77], //  4
  ['L', 90, 20], //  5 90° налево
  ['S', 184], //  6 старый город — узко
  ['L', 20, 80], //  7
  ['R', 20, 80], //  8
  ['S', 164], //  9
  ['L', 90, 30], // 10 90° налево
  ['S', 253], // 11
  ['R', 25, 180], // 12 туннель: S-изгиб
  ['L', 25, 180], // 13
  ['S', 453], // 14
  ['L', 90, 26], // 15 90° налево
  ['S', 176], // 16
  ['R', 90, 18], // 17 90° направо в «отросток»
  ['S', 260], // 18
  ['L', 180, 14], // 19 ШПИЛЬКА 180°
  ['S', 97], // 20
  ['R', 90, 18], // 21 90° направо
  ['S', 398], // 22 длинная улица к морю
  ['L', 90, 40], // 23 на набережную
  ['S', 57], // 24
]);

export default {
  id: 'street',
  name: 'Street Night',
  subtitle: 'Город · ночь · мокрый асфальт',
  description: 'Узкие улицы между домами, стены вплотную, туннель, шпилька и прямая вдоль набережной.',
  points: path,
  startOffset: 360,
  minWidth: 8,
  maxWidth: 11,
  width: keysAt(path, { 0: 11, 1: 10.5, 2: 10, 5: 9.5, 6: 8.2, 7: 8.1, 8: 8.1, 9: 8.4, 10: 9.5, 11: 10, 14: 10.5, 16: 10, 18: 9.5, 19: 10, 22: 10, 23: 10.5, 24: 11 }),
  height: keysAt(path, { 0: 0, 2: 0.5, 6: 3, 9: 4, 11: 2, 13: -1, 14: 0, 18: 1.5, 22: 1, 24: 0 }),
  bank: 0,
  kerbWidth: 0.8,
  kerbRadius: 220,
  lineMargin: 1.9, // стены близко — траектория с запасом от края
  // стены почти вплотную; в зонах торможения чуть больше места (аварийные выезды)
  runoffLeft: keysAt(path, { 0: 1.2, 1: 3.5, 2: 1, 6: 0.7, 9: 0.8, 10: 1.5, 11: 1, 15: 1.4, 18: 1, 19: 2.5, 20: 1, 22: 1, 23: 2, 24: 1.2 }),
  runoffRight: keysAt(path, { 0: 2.5, 1: 1.5, 2: 1, 3: 2, 6: 0.7, 9: 0.8, 10: 1, 11: 1, 17: 2, 19: 1.2, 21: 2, 22: 1, 24: 2.5 }),
  corners: [
    { t: path.tMid[1], name: 'Поворот 1', type: 'turn90' },
    { t: path.tMid[3], name: 'Квартал', type: 'turn90' },
    { t: path.tMid[5], name: 'Старый город', type: 'turn90' },
    { t: path.tMid[10], name: 'Бастион', type: 'turn90' },
    { t: path.tMid[15], name: 'Площадь', type: 'turn90' },
    { t: path.tMid[17], name: 'Отель', type: 'turn90' },
    { t: path.tMid[19], name: 'Шпилька', type: 'hairpin' },
    { t: path.tMid[21], name: 'Порт', type: 'turn90' },
    { t: path.tMid[23], name: 'Набережная', type: 'turn' },
  ],
  tunnel: { from: path.tStart[12] - 0.004, to: path.tMid[14] + 0.02 },
  grandstands: [{ t: 0.03, side: 'left', count: 3 }],
  env: {
    time: 'night',
    sky: { night: true, horizon: 0x2b2238, zenith: 0x03050d, stars: 1 },
    sun: { color: 0x9fb4ff, intensity: 0.35, elevation: 40, azimuth: 210 },
    hemi: { sky: 0x4a5a8a, ground: 0x1a1410, intensity: 0.18 },
    fog: { color: 0x0e1020, near: 120, far: 900 },
    exposure: 0.9,
    envIntensity: 0.35,
    far: 2200,
    ground: 'concrete',
    wall: 'concrete',
    wet: true,
    terrain: { flat: true, amp: 0, color: 0x6a6a6a, rocky: false, margin: 500, cell: 16 },
    sea: { dir: [-1, 0], shore: 28, level: -1.2 },
    bloom: { strength: 0.6, radius: 0.5, threshold: 0.85 },
    scenery: {
      buildings: { count: 520, near: 3, far: 160, height: [14, 70], lit: 0.36 },
      lamps: { spacing: 34, real: 6 },
      neon: { count: 90 },
      promenade: true,
    },
  },
};
