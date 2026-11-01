export const FORMS = ['GALAXY', 'BLACK HOLE', 'DNA', 'NEBULA', 'SINGULARITY'] as const;
export const FORM_COUNT = FORMS.length;
export const BLACK_HOLE = 1;

type Events = {
  morph: (form: number) => void;
  explode: (power: number) => void;
  implode: (duration: number) => void;
  beat: (strength: number) => void;
};

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Cosmic state machine: which form the swarm is becoming, how much mass has
 * collapsed into the singularity, and the after-shock of each detonation.
 * Everything visual is derived from this; nothing here touches the GPU.
 */
export class Universe {
  formA = 0;
  formB = 0;
  morph = 1;
  readonly morphDuration = 2.8;

  collapse = 0;
  private holders = new Set<string>();
  private criticalTime = 0;

  recover = 1;
  blastAge = 99;
  /** Impulse to apply on the next simulation step (consumed by the app). */
  blastImpulse = 0;

  spinTarget = 0;
  spinBoost = 0;
  galaxyAngle = 0;
  diskTime = 0;
  dnaAngle = 0;

  birth = 1;
  private birthing = false;

  flash = 0;
  shake = 0;
  shockR = 0;
  shockAmp = 0;
  private holeKill = 0;

  /** 0..1 while the universe draws its last breath before a detonation. */
  implode = 0;
  private implodeTimer = -1;
  private pendingPower = 0;
  /** Simulation speed: drops into bullet-time right after impact. */
  timeScale = 1;
  private slowmo = 0;
  /** Collapse heartbeat envelope (0..1), quickening as mass accumulates. */
  pulse = 0;
  private pulsePhase = 0;

  private listeners: { [K in keyof Events]: Events[K][] } = { morph: [], explode: [], implode: [], beat: [] };

  on<K extends keyof Events>(type: K, fn: Events[K]) {
    this.listeners[type].push(fn);
  }

  get form() {
    return this.formB;
  }

  get charging() {
    return this.holders.size > 0;
  }

  setForm(i: number) {
    const target = ((i % FORM_COUNT) + FORM_COUNT) % FORM_COUNT;
    if (target === this.formB) return;
    if (this.morph >= 1) {
      this.formA = this.formB;
    } else if (this.morph > 0.5) {
      this.formA = this.formB;
    }
    this.formB = target;
    this.morph = 0;
    for (const fn of this.listeners.morph) fn(target);
  }

  step(dir: number) {
    this.setForm(this.formB + dir);
  }

  startCollapse(source: string) {
    this.holders.add(source);
  }

  /** Release a hold. Detonates if enough mass has gathered. */
  releaseCollapse(source: string, detonate = true) {
    if (!this.holders.delete(source)) return;
    if (this.holders.size === 0 && detonate && this.collapse > 0.18) this.explode();
  }

  cancelAllHolds() {
    this.holders.clear();
  }

  /** Detonate: a short implosion (anticipation) is followed by the blast (impact). */
  explode(power = 0.35 + 0.65 * this.collapse) {
    if (this.implodeTimer >= 0) return;
    this.holders.clear();
    this.pendingPower = power;
    this.implodeTimer = 0.16 + 0.22 * this.collapse;
    for (const fn of this.listeners.implode) fn(this.implodeTimer);
  }

  get detonating() {
    return this.implodeTimer >= 0;
  }

  private detonate() {
    const power = this.pendingPower;
    this.implodeTimer = -1;
    this.implode = 0;
    this.slowmo = 1;
    this.blastImpulse = power;
    this.blastAge = 0;
    this.recover = 0;
    this.flash = Math.max(this.flash, 0.5 + power * 0.7);
    this.shake = Math.max(this.shake, power);
    this.shockR = 0;
    this.shockAmp = 0.6 + power;
    this.holeKill = 1;
    this.collapse = 0;
    this.criticalTime = 0;
    for (const fn of this.listeners.explode) fn(power);
  }

  rebirth() {
    this.implodeTimer = -1;
    this.implode = 0;
    this.slowmo = 0;
    this.birth = 0;
    this.birthing = true;
    this.collapse = 0;
    this.holders.clear();
    this.recover = 1;
    this.blastAge = 99;
    this.formA = this.formB = 0;
    this.morph = 1;
  }

  /** Fade the swarm back in without resetting the story (after a quality rebuild). */
  regather() {
    this.birth = 0.2;
    this.birthing = true;
  }

  /** Eased weight (0..1) of a form in the current blend. */
  formWeight(id: number) {
    const m = smooth(0, 1, this.morph);
    let w = 0;
    if (this.formA === id) w += 1 - m;
    if (this.formB === id) w += m;
    return Math.min(1, w);
  }

  /** How strongly the black-hole lens/shadow should be drawn. */
  get holeStrength() {
    const fromForm = this.formWeight(BLACK_HOLE) * (1 - this.holeKill) * this.recover;
    return Math.max(fromForm, smooth(0.12, 0.85, this.collapse));
  }

  /** Event horizon radius in world units. */
  get horizonRadius() {
    const c = smooth(0.12, 0.85, this.collapse);
    return Math.max(0.55 * this.formWeight(BLACK_HOLE), 0.18 + 0.42 * c);
  }

  /** Fraction of particles destined to fall through the horizon. */
  get consume() {
    return smooth(0.3, 1.0, this.collapse) * 0.78;
  }

  update(realDt: number) {
    // anticipation → impact
    if (this.implodeTimer >= 0) {
      this.implodeTimer -= realDt;
      this.implode = Math.min(1, this.implode + realDt * 7);
      if (this.implodeTimer <= 0) this.detonate();
    }
    // bullet-time: hold briefly near-frozen, then ease back to real time
    this.slowmo = Math.max(0, this.slowmo - realDt * (this.slowmo > 0.85 ? 0.9 : 1.3));
    this.timeScale = 1 - 0.85 * smooth(0, 1, this.slowmo);
    const dt = realDt * this.timeScale;

    if (this.morph < 1) this.morph = Math.min(1, this.morph + dt / this.morphDuration);

    if (this.implodeTimer >= 0) {
      // mass is frozen while the universe holds its breath
    } else if (this.charging) {
      this.collapse = Math.min(1, this.collapse + dt * 0.22);
      // a fully collapsed singularity cannot hold forever
      if (this.collapse >= 1) {
        this.criticalTime += dt;
        if (this.criticalTime > 2.8) this.explode(1.1);
      }
    } else {
      this.collapse = Math.max(0, this.collapse - dt * 0.35);
      this.criticalTime = 0;
    }

    this.blastAge += dt;
    this.recover = smooth(0.25, 3.4, this.blastAge);

    this.spinBoost += (this.spinTarget - this.spinBoost) * Math.min(1, dt * 1.8);
    this.galaxyAngle += dt * (0.09 + this.spinBoost * 0.9 + (1 - this.birth) * 1.8);
    this.diskTime += dt * (1 + this.collapse * 2.6 + this.spinBoost * 0.6);
    this.dnaAngle += dt * (0.35 + this.spinBoost * 0.8);

    if (this.birthing) {
      this.birth = Math.min(1, this.birth + dt / 2.7);
      if (this.birth >= 1) this.birthing = false;
    }

    // heartbeat: faster and harder the more mass is gathered
    if (this.collapse > 0.02 && this.implodeTimer < 0) {
      const before = this.pulsePhase;
      this.pulsePhase += dt * (0.7 + 2.6 * this.collapse);
      if (Math.floor(this.pulsePhase) !== Math.floor(before)) for (const fn of this.listeners.beat) fn(this.collapse);
      const f = this.pulsePhase % 1;
      this.pulse = Math.exp(-f * 9) * smooth(0.05, 0.4, this.collapse);
    } else {
      this.pulse *= Math.exp(-realDt * 8);
    }

    this.flash *= Math.exp(-realDt * 7.0);
    this.shake *= Math.exp(-realDt * 2.4);
    this.shockR += dt * (0.75 + this.shockAmp * 0.5);
    this.shockAmp *= Math.exp(-dt * 1.3);
    this.holeKill *= Math.exp(-dt * 0.6);
  }
}
