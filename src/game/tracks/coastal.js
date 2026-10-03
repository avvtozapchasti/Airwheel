// «Coastal Sprint» — побережье на закате: море вдоль самой быстрой прямой, 90° направо
// после неё, длинные быстрые дуги, две шпильки, мост над лагуной, пальмы и дюны.
import { turtle, keysAt } from './turtle.js';

const path = turtle([
  ['S', 918], //  0 прямая вдоль моря — самая быстрая
  ['R', 90, 28], //  1 90° направо после неё
  ['S', 256], //  2
  ['R', 40, 250], //  3 длинная быстрая дуга
  ['S', 142], //  4
  ['L', 40, 250], //  5 и обратно
  ['S', 126], //  6
  ['R', 180, 24], //  7 ШПИЛЬКА 1
  ['S', 94], //  8
  ['L', 90, 40], //  9
  ['S', 282], // 10
  ['R', 30, 300], // 11 быстрая дуга
  ['S', 180], // 12
  ['R', 30, 150], // 13 въезд на мост
  ['S', 235], // 14 МОСТ над лагуной
  ['R', 30, 200], // 15
  ['S', 144], // 16
  ['L', 90, 30], // 17
  ['S', 102], // 18
  ['R', 180, 22], // 19 ШПИЛЬКА 2
  ['S', 268], // 20 выход на набережную
]);

export default {
  id: 'coastal',
  name: 'Coastal Sprint',
  subtitle: 'Побережье · закат · мост',
  description: 'Прямая вдоль моря, 90° после неё, быстрые дуги, две шпильки и мост над лагуной.',
  points: path,
  startOffset: 300,
  runoffSurface: 'sand',
  width: keysAt(path, { 0: 15, 1: 14, 2: 14, 7: 13, 8: 13, 10: 14, 14: 12.5, 16: 13.5, 19: 13, 20: 14.5 }),
  height: keysAt(path, { 0: 2, 1: 2, 3: 4, 6: 3, 7: 3, 10: 5, 12: 5, 13: 8, 14: 10, 15: 7, 16: 5, 18: 4, 19: 3, 20: 2 }),
  bank: keysAt(path, { 0: 0, 3: -3, 4: 0, 5: 3, 6: 0, 11: -3, 12: 0 }),
  runoffLeft: keysAt(path, { 0: 5, 1: 12, 2: 10, 6: 10, 7: 7, 8: 8, 10: 10, 13: 4, 14: 1.6, 15: 4, 16: 9, 18: 8, 19: 12, 20: 6 }),
  runoffRight: keysAt(path, { 0: 12, 1: 8, 2: 10, 6: 7, 7: 6, 8: 7, 10: 10, 13: 4, 14: 1.6, 15: 4, 16: 9, 18: 8, 19: 7, 20: 10 }),
  corners: [
    { t: path.tMid[1], name: 'Маяк', type: 'turn90' },
    { t: path.tMid[7], name: 'Шпилька', type: 'hairpin' },
    { t: path.tMid[9], name: 'Дюна', type: 'turn90' },
    { t: path.tMid[17], name: 'Пристань', type: 'turn90' },
    { t: path.tMid[19], name: 'Шпилька', type: 'hairpin' },
  ],
  bridge: { from: path.tStart[14] - 0.004, to: path.tStart[15] + 0.004, lagoon: path.tMid[14], radius: 95 },
  grandstands: [{ t: 0.03, side: 'right', count: 3 }, { t: path.tMid[7], side: 'out', count: 2 }],
  env: {
    time: 'sunset',
    sky: { turbidity: 7, rayleigh: 2.6, mie: 0.012, mieG: 0.9, elevation: 5, azimuth: 70 },
    sun: { color: 0xffb070, intensity: 2.1 },
    hemi: { sky: 0xffc9a0, ground: 0x6a5238, intensity: 0.4 },
    fog: { color: 0xd89c7a, near: 480, far: 3000 },
    exposure: 0.78,
    envIntensity: 0.55,
    far: 4200,
    ground: 'sand',
    wall: 'tyres',
    terrain: { amp: 14, scale: 1 / 160, rise: 0.03, riseMax: 25, color: 0xe8d2a8, rocky: false, margin: 900 },
    sea: { dir: [1, 0], shore: 45, level: 0.2 },
    bloom: { strength: 0.22, radius: 0.4, threshold: 3.2 },
    scenery: {
      palms: { count: 900, near: 5, far: 260, scale: 1.1, lod: 220 },
      rocks: { count: 90, far: 160 },
    },
  },
};
