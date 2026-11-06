import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { GestureClassifier, type GestureEvents, type GestureState } from './GestureClassifier';

// Shipped in public/ (not fetched from Google's model bucket) so tracking also works where Google is blocked.
const MODEL_PATH = 'mediapipe/models/hand_landmarker.task';

const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

export type HandListener = (state: GestureState, events: GestureEvents) => void;

/**
 * Webcam + MediaPipe HandLandmarker. Only started after an explicit user click.
 * The WASM runtime and the ~8 MB model are served from this site and loaded on first use.
 */
export class HandTracker {
  running = false;
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private classifier = new GestureClassifier();
  private lastVideoTime = -1;
  private raf = 0;
  private ctx: CanvasRenderingContext2D | null;

  constructor(
    private video: HTMLVideoElement,
    private overlay: HTMLCanvasElement,
    private listener: HandListener,
  ) {
    this.ctx = overlay.getContext('2d');
  }

  async start(onStatus: (msg: string) => void) {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable (HTTPS required)');
    onStatus('REQUESTING CAMERA');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();

    if (!this.landmarker) {
      onStatus('LOADING HAND MODEL');
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
      const wasmBase = new URL(`${import.meta.env.BASE_URL}mediapipe/wasm`, location.href).href;
      const modelUrl = new URL(`${import.meta.env.BASE_URL}${MODEL_PATH}`, location.href).href;
      const fileset = await FilesetResolver.forVisionTasks(wasmBase);
      const make = (delegate: 'GPU' | 'CPU') =>
        HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.5,
        });
      try {
        this.landmarker = await make('GPU');
      } catch {
        this.landmarker = await make('CPU');
      }
    }

    const vw = this.video.videoWidth || 640;
    const vh = this.video.videoHeight || 480;
    this.classifier.opts.aspect = vw / vh;
    this.overlay.width = vw;
    this.overlay.height = vh;
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ctx?.clearRect(0, 0, this.overlay.width, this.overlay.height);
    const { state, events } = this.classifier.update(null, 0, Number.POSITIVE_INFINITY);
    this.listener(state, events);
  }

  private loop = () => {
    if (!this.running || !this.landmarker) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.video.readyState < 2 || this.video.currentTime === this.lastVideoTime) return;
    this.lastVideoTime = this.video.currentTime;
    const now = performance.now();
    const res = this.landmarker.detectForVideo(this.video, now);
    const lms = res.landmarks?.[0] ?? null;
    const score = res.handedness?.[0]?.[0]?.score ?? 0;
    const { state, events } = this.classifier.update(lms, score, now / 1000);
    this.draw(state);
    this.listener(state, events);
  };

  private draw(state: GestureState) {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: w, height: h } = this.overlay;
    ctx.clearRect(0, 0, w, h);
    const L = this.classifier.landmarks;
    if (!L || !state.present) return;
    const gold = state.pinch ? 'rgba(255,214,150,0.95)' : 'rgba(170,215,255,0.85)';
    ctx.strokeStyle = gold;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(L[a].x * w, L[a].y * h);
      ctx.lineTo(L[b].x * w, L[b].y * h);
    }
    ctx.stroke();
    ctx.fillStyle = gold;
    for (const p of L) {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
