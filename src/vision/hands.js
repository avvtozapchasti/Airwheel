// Обёртка над MediaPipe HandLandmarker. Всё, что знает про MediaPipe, живёт здесь.
// На выходе — массив рук с уже ЗЕРКАЛЬНЫМИ координатами (x = 1 - x),
// чтобы «левая рука на экране» совпадала с левой рукой игрока.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const WASM_PATH = `${BASE}wasm`;
const MODEL_PATH = `${BASE}models/hand_landmarker.task`;

// Соединения точек руки для отрисовки скелета.
export const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export class HandTracker {
  constructor() {
    this.landmarker = null;
    this.lastTs = -1;
    this.delegate = null;
  }

  async init() {
    const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
      this.delegate = 'GPU';
    } catch (e) {
      console.warn('GPU недоступен, переключаюсь на CPU', e);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
      this.delegate = 'CPU';
    }
  }

  // Возвращает [{ landmarks: [{x,y,z}...21], score }] или null, если кадр не обработан.
  detect(video, nowMs) {
    if (!this.landmarker || video.readyState < 2) return null;
    // В режиме VIDEO метки времени обязаны строго возрастать.
    const ts = Math.max(Math.round(nowMs), this.lastTs + 1);
    this.lastTs = ts;
    let res;
    try {
      res = this.landmarker.detectForVideo(video, ts);
    } catch (e) {
      console.warn('Ошибка инференса', e);
      return null;
    }
    const hands = [];
    const lms = res?.landmarks || [];
    for (let i = 0; i < lms.length; i++) {
      hands.push({
        landmarks: lms[i].map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
        score: res.handedness?.[i]?.[0]?.score ?? 1,
      });
    }
    return hands;
  }
}

// Рисует скелет рук поверх превью. color — функция (index) => цвет.
export function drawHands(ctx, hands, w, h, colorFor) {
  ctx.lineWidth = Math.max(2, w / 160);
  hands.forEach((hand, i) => {
    const color = colorFor(i, hand);
    const pts = hand.landmarks;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.moveTo(pts[a].x * w, pts[a].y * h);
      ctx.lineTo(pts[b].x * w, pts[b].y * h);
    }
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, ctx.lineWidth * 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
