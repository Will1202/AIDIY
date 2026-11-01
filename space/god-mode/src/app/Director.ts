import type { Universe } from './Universe';

/** What the director needs from the app to "play" the user. */
export interface Stage {
  universe: Universe;
  /** Virtual hand position in NDC, or null to release it. */
  setDemoPointer(ndc: { x: number; y: number } | null, gather: number): void;
  rebirth(): void;
}

type Cue = { at: number; run: (s: Stage) => void };

const SOURCE = 'director';

/**
 * Cinematic autopilot tuned for a 15–30 s vertical video:
 *  0–3 birth · 3–7 spin-up · 7–12 collapse · 12 detonation · 17+ metamorphoses.
 * Runs whenever nobody is playing; any real interaction hands control back.
 */
export class Director {
  active = false;
  time = 0;
  private cueIndex = 0;
  private gathering = false;

  private readonly cues: Cue[] = [
    { at: 0.0, run: (s) => s.rebirth() },
    { at: 3.0, run: () => (this.gathering = true) },
    { at: 7.0, run: (s) => { this.gathering = false; s.universe.startCollapse(SOURCE); } },
    { at: 12.0, run: (s) => s.universe.releaseCollapse(SOURCE, true) },
    { at: 17.0, run: (s) => s.universe.setForm(2) },
    { at: 21.0, run: (s) => s.universe.setForm(3) },
    { at: 25.0, run: (s) => s.universe.setForm(4) },
    { at: 29.0, run: (s) => s.universe.setForm(1) },
    { at: 33.5, run: (s) => s.universe.setForm(0) },
  ];
  private readonly loopAt = 37.5;
  private readonly loopTo = 1.0;

  constructor(private stage: Stage) {}

  /** Start from the big bang (true) or resume the show mid-way (false). */
  start(fromBirth: boolean) {
    this.active = true;
    this.time = fromBirth ? 0 : this.loopTo;
    this.cueIndex = this.cues.findIndex((c) => c.at >= this.time);
    if (!fromBirth) this.stage.universe.setForm(0);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.gathering = false;
    this.stage.universe.releaseCollapse(SOURCE, false);
    this.stage.universe.spinTarget = 0;
    this.stage.setDemoPointer(null, 0);
  }

  update(dt: number) {
    if (!this.active) return;
    this.time += dt;
    while (this.cueIndex >= 0 && this.cueIndex < this.cues.length && this.cues[this.cueIndex].at <= this.time) {
      this.cues[this.cueIndex].run(this.stage);
      this.cueIndex++;
    }
    if (this.time >= this.loopAt) {
      this.time = this.loopTo;
      this.cueIndex = this.cues.findIndex((c) => c.at >= this.loopTo);
    }

    const t = this.time;
    if (this.gathering) {
      // an invisible hand stirs the galaxy into a frenzy
      const k = Math.min(1, (t - 3.0) / 1.0);
      const a = t * 2.6;
      this.stage.setDemoPointer({ x: Math.cos(a) * 0.16, y: Math.sin(a) * 0.12 }, k * 0.55);
      this.stage.universe.spinTarget = 2.8 * k;
    } else if (t > 3.5) {
      // idle drift: a lazy lissajous that keeps the field breathing
      this.stage.setDemoPointer({ x: Math.sin(t * 0.37) * 0.55, y: Math.sin(t * 0.53 + 1.2) * 0.4 }, 0);
      this.stage.universe.spinTarget = 0;
    } else {
      this.stage.setDemoPointer(null, 0);
    }
  }
}
