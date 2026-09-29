// Копирует WASM-файлы MediaPipe из node_modules в public/wasm,
// чтобы приложение не зависело от внешнего CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve('node_modules/@mediapipe/tasks-vision/wasm');
const dst = resolve('public/wasm');
if (existsSync(src)) {
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true });
  console.log('[airwheel] WASM скопирован в public/wasm');
}
