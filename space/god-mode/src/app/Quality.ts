export interface Tier {
  name: string;
  /** Simulation texture edge; particles = size². */
  size: number;
  maxDpr: number;
  bloomScale: number;
  trails: boolean;
  octaves: number;
}

export const TIERS: Tier[] = [
  { name: 'LOW', size: 128, maxDpr: 1, bloomScale: 0.5, trails: false, octaves: 2 },
  { name: 'MED', size: 256, maxDpr: 1.25, bloomScale: 0.6, trails: true, octaves: 3 },
  { name: 'HIGH', size: 384, maxDpr: 1.5, bloomScale: 0.75, trails: true, octaves: 4 },
  { name: 'ULTRA', size: 512, maxDpr: 2, bloomScale: 1, trails: true, octaves: 4 },
];

export const isTouchDevice = () =>
  matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * Picks a starting tier from the device class, then watches the real frame rate
 * and steps down (or once, up) so the piece stays fluid rather than impressive on paper.
 */
export class QualityManager {
  mode: 'auto' | number = 'auto';
  tier: number;
  private readonly ceiling: number;
  private frames = 0;
  private time = 0;
  private elapsed = 0;
  private upgrades = 0;
  private locked = false;

  constructor(private onChange: (tier: number) => void, maxTextureSize: number) {
    const touch = isTouchDevice();
    const cores = navigator.hardwareConcurrency ?? 4;
    this.ceiling = touch ? 2 : 3;
    this.tier = touch ? (cores >= 6 ? 1 : 0) : 2;
    while (TIERS[this.tier].size > maxTextureSize && this.tier > 0) this.tier--;
  }

  get label() {
    return this.mode === 'auto' ? `AUTO · ${TIERS[this.tier].name}` : TIERS[this.tier].name;
  }

  /** Cycle AUTO → LOW → MED → HIGH → ULTRA → AUTO. */
  cycle() {
    if (this.mode === 'auto') this.mode = 0;
    else if (this.mode >= TIERS.length - 1) this.mode = 'auto';
    else this.mode += 1;
    if (this.mode !== 'auto') this.set(this.mode);
    else this.resetSampling();
  }

  private set(t: number) {
    if (t === this.tier) return;
    this.tier = t;
    this.resetSampling();
    this.onChange(t);
  }

  private resetSampling() {
    this.frames = 0;
    this.time = 0;
  }

  sample(dt: number) {
    this.elapsed += dt;
    if (this.mode !== 'auto' || this.locked || this.elapsed < 4) return;
    this.frames++;
    this.time += dt;
    if (this.time < 2.5) return;
    const fps = this.frames / this.time;
    this.resetSampling();
    if (fps < 40 && this.tier > 0) {
      if (this.upgrades > 0) this.locked = true;
      this.set(this.tier - 1);
    } else if (fps > 58 && this.tier < this.ceiling && this.upgrades < 1 && this.elapsed < 25) {
      this.upgrades++;
      this.set(this.tier + 1);
    }
  }
}
