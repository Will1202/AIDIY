export type Landmark = { x: number; y: number; z: number };

export interface GestureState {
  present: boolean;
  /** Palm centre in mirrored (selfie) screen space, 0..1. */
  x: number;
  y: number;
  pinch: boolean;
  openness: number;
  label: 'NO HAND' | 'TRACKING' | 'PINCH' | 'OPEN' | 'FIST';
}

export interface GestureEvents {
  explode: boolean;
  swipe: -1 | 0 | 1;
}

export interface GestureOptions {
  /** Video width / height — landmarks are normalised per axis. */
  aspect: number;
  minScore: number;
  pinchOn: number;
  pinchOff: number;
  openOn: number;
  stableFrames: number;
  explodeWindow: number;
  explodeCooldown: number;
  swipeDistance: number;
  swipeWindow: number;
  swipeCooldown: number;
  smoothing: number;
  lostTimeout: number;
}

const DEFAULTS: GestureOptions = {
  aspect: 4 / 3,
  minScore: 0.65,
  pinchOn: 0.32,
  pinchOff: 0.46,
  openOn: 0.78,
  stableFrames: 3,
  explodeWindow: 0.8,
  explodeCooldown: 1.5,
  swipeDistance: 0.22,
  swipeWindow: 0.32,
  swipeCooldown: 0.9,
  smoothing: 0.5,
  lostTimeout: 0.25,
};

// [mcp, pip, tip] for index, middle, ring, little
const FINGERS: [number, number, number][] = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];
const PALM = [0, 5, 9, 13, 17];

/**
 * Turns raw MediaPipe hand landmarks into stable intents.
 * Smoothing + hysteresis + frame-stability + cooldowns keep false triggers rare.
 * Pure logic (no DOM) so it can be unit tested.
 */
export class GestureClassifier {
  readonly opts: GestureOptions;
  private smooth: Landmark[] | null = null;
  private pinch = false;
  private pinchFrames = 0;
  private openFrames = 0;
  private palmOpen = false;
  private lastClosed = -Infinity;
  private lastExplode = -Infinity;
  private lastSwipe = -Infinity;
  private lastSeen = -Infinity;
  private history: { t: number; x: number; y: number }[] = [];
  private state: GestureState = { present: false, x: 0.5, y: 0.5, pinch: false, openness: 0, label: 'NO HAND' };

  constructor(opts: Partial<GestureOptions> = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  update(landmarks: Landmark[] | null, score: number, t: number): { state: GestureState; events: GestureEvents } {
    const o = this.opts;
    const events: GestureEvents = { explode: false, swipe: 0 };

    if (!landmarks || landmarks.length < 21 || score < o.minScore) {
      if (t - this.lastSeen > o.lostTimeout) this.reset();
      return { state: this.state, events };
    }
    this.lastSeen = t;

    // exponential smoothing of every landmark
    if (!this.smooth) this.smooth = landmarks.map((p) => ({ ...p }));
    else {
      const k = o.smoothing;
      for (let i = 0; i < 21; i++) {
        const s = this.smooth[i];
        const p = landmarks[i];
        s.x += (p.x - s.x) * k;
        s.y += (p.y - s.y) * k;
        s.z += (p.z - s.z) * k;
      }
    }
    const L = this.smooth;
    const dist = (a: number, b: number) => Math.hypot((L[a].x - L[b].x) * o.aspect, L[a].y - L[b].y);
    const scale = Math.max(dist(0, 9), 1e-4);

    // pinch with hysteresis + stability
    const pinchDist = dist(4, 8) / scale;
    const wantPinch = this.pinch ? pinchDist < o.pinchOff : pinchDist < o.pinchOn;
    this.pinchFrames = wantPinch === this.pinch ? 0 : this.pinchFrames + 1;
    if (this.pinchFrames >= o.stableFrames) {
      this.pinch = wantPinch;
      this.pinchFrames = 0;
    }

    // openness: how far each fingertip reaches beyond its middle joint
    let open = 0;
    for (const [, pip, tip] of FINGERS) {
      const ratio = dist(0, tip) / Math.max(dist(0, pip), 1e-4);
      open += Math.min(1, Math.max(0, (ratio - 0.95) / 0.45));
    }
    open /= FINGERS.length;

    if (this.pinch || open < 0.35) this.lastClosed = t;

    const wantOpen = open > o.openOn && !this.pinch && pinchDist > o.pinchOff;
    this.openFrames = wantOpen ? this.openFrames + 1 : 0;
    const nowOpen = this.openFrames >= o.stableFrames;
    if (nowOpen && !this.palmOpen) {
      // a hand that bursts open from a pinch or fist = detonation
      if (t - this.lastClosed < o.explodeWindow && t - this.lastExplode > o.explodeCooldown) {
        events.explode = true;
        this.lastExplode = t;
      }
    }
    this.palmOpen = nowOpen;

    // palm centre (mirrored so it matches a selfie view)
    let cx = 0;
    let cy = 0;
    for (const i of PALM) {
      cx += L[i].x;
      cy += L[i].y;
    }
    cx = 1 - cx / PALM.length;
    cy = cy / PALM.length;

    // horizontal swipe
    this.history.push({ t, x: cx, y: cy });
    while (this.history.length && t - this.history[0].t > o.swipeWindow) this.history.shift();
    const first = this.history[0];
    if (first && !events.explode && !this.pinch && open > 0.4 && t - this.lastSwipe > o.swipeCooldown) {
      const dx = cx - first.x;
      const dy = cy - first.y;
      if (Math.abs(dx) > o.swipeDistance && Math.abs(dy) < Math.abs(dx) * 0.7) {
        events.swipe = dx > 0 ? 1 : -1;
        this.lastSwipe = t;
        this.history = [];
      }
    }

    this.state = {
      present: true,
      x: cx,
      y: cy,
      pinch: this.pinch,
      openness: open,
      label: this.pinch ? 'PINCH' : this.palmOpen ? 'OPEN' : open < 0.3 ? 'FIST' : 'TRACKING',
    };
    return { state: this.state, events };
  }

  /** Smoothed landmarks (raw image space) for drawing the overlay. */
  get landmarks() {
    return this.smooth;
  }

  private reset() {
    this.smooth = null;
    this.pinch = false;
    this.pinchFrames = 0;
    this.openFrames = 0;
    this.palmOpen = false;
    this.history = [];
    this.state = { present: false, x: this.state.x, y: this.state.y, pinch: false, openness: 0, label: 'NO HAND' };
  }
}
