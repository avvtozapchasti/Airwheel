// «Neon Harbor» — порт и промзона ночью: прямая вдоль причала, контейнерный терминал,
// склады, портальные краны над обратной прямой, эстакада над трассой, неон, мокрый асфальт.
// Только данные: раскладка, профили, повороты, окружение (сценарий порта — scenery 'port').
import { turtle, keysAt } from './turtle.js';

const path = turtle([
  ['S', 800], //  0 прямая вдоль причала — самая длинная
  ['L', 90, 32], //  1 «Причал» — 90° под тормоз
  ['S', 240], //  2
  ['R', 90, 40], //  3 «Терминал» — в контейнерный двор
  ['S', 130], //  4 узко между штабелями
  ['L', 90, 45], //  5
  ['S', 81], //  6
  ['L', 90, 70], //  7 разворот к кранам
  ['S', 560], //  8 обратная прямая под кранами и эстакадой
  ['L', 30, 160], //  9 быстрый излом
  ['S', 110], // 10
  ['R', 30, 160], // 11
  ['S', 160], // 12
  ['L', 90, 30], // 13 «Склады»
  ['S', 300], // 14
  ['R', 90, 32], // 15 к пирсу
  ['S', 90], // 16
  ['L', 180, 24], // 17 ШПИЛЬКА «Пирс»
  ['S', 150], // 18 выход на причал
]);

export default {
  id: 'harbor',
  name: 'Neon Harbor',
  subtitle: 'Порт · ночь · неон и краны',
  description: 'Причал, контейнерный терминал, обратная прямая под портальными кранами и шпилька на пирсе.',
  points: path,
  startOffset: 420,
  pit: { side: 'left', from: -300, to: 230 },
  minWidth: 11,
  maxWidth: 14,
  width: keysAt(path, { 0: 13.5, 1: 13, 2: 12.5, 3: 12, 4: 11, 5: 11.5, 7: 12.5, 8: 13.5, 11: 13, 13: 12.5, 15: 12, 17: 12.5, 18: 13.5 }),
  height: keysAt(path, { 0: 0.5, 2: 0.6, 4: 1, 8: 1.5, 12: 1, 14: 0.6, 17: 0.4 }),
  bank: 0,
  kerbWidth: 1.0,
  kerbRadius: 240,
  lineMargin: 1.7,
  runoffSurface: 'runoff', // за поребриком — бетон порта
  runoffLeft: keysAt(path, { 0: 6, 1: 4, 2: 3, 4: 1.5, 6: 2.5, 8: 3, 12: 3, 14: 2.5, 16: 3, 17: 5, 18: 6 }),
  runoffRight: keysAt(path, { 0: 3, 1: 8, 2: 3, 3: 4, 4: 1.5, 8: 3, 13: 5, 15: 4, 17: 3, 18: 3 }),
  corners: [
    { t: path.tMid[1], name: 'Причал', type: 'turn90' },
    { t: path.tMid[3], name: 'Терминал', type: 'turn90' },
    { t: path.tMid[5], name: 'Штабели', type: 'turn90' },
    { t: path.tMid[7], name: 'Краны', type: 'turn90' },
    { t: path.tMid[13], name: 'Склады', type: 'turn90' },
    { t: path.tMid[15], name: 'Пирс', type: 'turn90' },
    { t: path.tMid[17], name: 'Шпилька', type: 'hairpin' },
  ],
  overpass: [path.tMid[8] + 0.02], // эстакада над обратной прямой
  grandstands: [{ t: path.tStart[0] + 0.07, side: 'right', count: 3 }],
  env: {
    time: 'night',
    sky: { night: true, horizon: 0x2a1d3a, zenith: 0x04060f, stars: 0.7 },
    sun: { color: 0xa8b8ff, intensity: 0.3, elevation: 35, azimuth: 150 },
    hemi: { sky: 0x3a4870, ground: 0x15110d, intensity: 0.2 },
    fog: { color: 0x120f22, near: 140, far: 1000 },
    exposure: 0.95,
    envIntensity: 0.4,
    far: 2400,
    ground: 'concrete',
    wall: 'concrete',
    wet: true,
    terrain: { flat: true, amp: 0, color: 0x5d6066, rocky: false, margin: 520, cell: 16 },
    sea: { dir: [-1, 0], shore: 26, level: -1.4 },
    bloom: { strength: 0.75, radius: 0.55, threshold: 0.8 },
    scenery: {
      port: { containers: 900, cranes: 7, warehouses: 26 },
      lamps: { spacing: 32 },
      neon: { count: 70 },
      buildings: { count: 160, near: 40, far: 260, height: [10, 46], lit: 0.3, back: true },
    },
  },
};
