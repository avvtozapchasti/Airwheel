// Тестовая трасса для отладки сцены: простой замкнутый сплайн с перепадом высот.
export default {
  id: 'test',
  name: 'Тестовый круг',
  points: [
    [0, 0], [0, 250], [30, 420], [140, 500], [300, 480], [380, 380],
    [360, 250], [420, 120], [400, -60], [280, -140], [120, -130], [20, -80],
  ],
  width: 14,
  height: [[0, 0], [0.2, 6], [0.45, 14], [0.7, 4], [0.9, -2]],
  bank: 0,
  runoff: 10,
  env: {
    sky: { turbidity: 5, rayleigh: 1.4, elevation: 32, azimuth: 140 },
    sun: { color: 0xfff1dc, intensity: 3.2 },
    hemi: { sky: 0xcfe3ff, ground: 0x4a5a38, intensity: 0.7 },
    fog: { color: 0xc9dbe8, near: 250, far: 1800 },
    exposure: 0.9,
  },
};
