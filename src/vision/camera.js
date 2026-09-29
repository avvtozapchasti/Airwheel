// Работа с веб-камерой: запрос доступа, смена разрешения, понятные ошибки на русском.

const ERROR_TEXT = {
  NotAllowedError: 'Доступ к камере запрещён. Разреши его в настройках браузера или играй с клавиатуры.',
  SecurityError: 'Браузер запретил камеру. Открой сайт по HTTPS или играй с клавиатуры.',
  NotFoundError: 'Камера не найдена. Подключи камеру или играй с клавиатуры.',
  NotReadableError: 'Камера занята другим приложением. Закрой его и попробуй снова.',
  OverconstrainedError: 'Камера не поддерживает нужный режим. Попробуй другую камеру.',
  NoMediaDevices: 'Браузер не поддерживает камеру (нужен HTTPS и современный браузер).',
};

export function cameraErrorText(err) {
  const name = err?.name || 'Unknown';
  return ERROR_TEXT[name] || `Не удалось включить камеру (${name}). Играй с клавиатуры.`;
}

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.width = 640;
    this.height = 480;
  }

  get ready() {
    return !!this.stream && this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  async start(width = 640, height = 480) {
    if (!navigator.mediaDevices?.getUserMedia) {
      const e = new Error('no mediaDevices');
      e.name = 'NoMediaDevices';
      throw e;
    }
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user', // фронтальная камера на телефоне
        width: { ideal: width },
        height: { ideal: height },
        frameRate: { ideal: 30, max: 60 },
      },
    });
    this.video.srcObject = this.stream;
    await this.video.play().catch(() => {});
    await new Promise((res) => {
      if (this.video.readyState >= 2) return res();
      this.video.onloadeddata = () => res();
    });
    this.width = this.video.videoWidth;
    this.height = this.video.videoHeight;
    return this.stream;
  }

  // Понижение разрешения при низком FPS (без перезапроса разрешения у пользователя).
  async downgrade(width = 640, height = 480) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ width: { ideal: width }, height: { ideal: height } });
      this.width = this.video.videoWidth;
      this.height = this.video.videoHeight;
    } catch {
      /* не критично */
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
