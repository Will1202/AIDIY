export interface AudioState {
  collapse: number;
  spin: number;
  pointerSpeed: number;
  hole: number;
}

/**
 * Fully synthesised score — no samples. A deep drone bed, cosmic wind that follows
 * the hand, a gravitational riser during collapse, and a sub-bass detonation.
 * Created lazily on the first click of the SOUND toggle (browsers forbid autoplay).
 */
export class AudioEngine {
  enabled = false;
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wet!: GainNode;
  private droneGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private airGain!: GainNode;
  private airFilter!: BiquadFilterNode;
  private riserGain!: GainNode;
  private riserFilter!: BiquadFilterNode;
  private riserOscs: OscillatorNode[] = [];
  private subGain!: GainNode;
  private sub!: OscillatorNode;
  private noise!: AudioBuffer;
  private duckUntil = 0;

  async enable() {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    await ctx.resume();
    this.enabled = true;
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
  }

  disable() {
    if (!this.ctx) return;
    this.enabled = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.impulse(4.5, 2.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.wet.connect(reverb);
    reverb.connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    // drone bed: root, fifth, octave + a slowly breathing filter
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 340;
    this.droneFilter.Q.value = 0.9;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.13;
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.master);
    this.droneGain.connect(this.wet);
    const voices: [OscillatorType, number, number][] = [
      ['sine', 55, 0.5],
      ['sine', 82.41, 0.28],
      ['triangle', 110.2, 0.18],
      ['sawtooth', 55.15, 0.07],
      ['sawtooth', 164.9, 0.03],
    ];
    for (const [type, f, g] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(this.droneFilter);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 140;
    lfo.connect(lfoGain).connect(this.droneFilter.frequency);
    lfo.start();

    // cosmic wind
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = 'bandpass';
    this.airFilter.frequency.value = 700;
    this.airFilter.Q.value = 0.8;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0.02;
    air.connect(this.airFilter).connect(this.airGain);
    this.airGain.connect(this.master);
    this.airGain.connect(this.wet);
    air.start();

    // collapse riser
    this.riserFilter = ctx.createBiquadFilter();
    this.riserFilter.type = 'lowpass';
    this.riserFilter.frequency.value = 200;
    this.riserFilter.Q.value = 6;
    this.riserGain = ctx.createGain();
    this.riserGain.gain.value = 0;
    this.riserFilter.connect(this.riserGain);
    this.riserGain.connect(this.master);
    this.riserGain.connect(this.wet);
    for (const det of [0, 7, -5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 40;
      o.detune.value = det;
      o.connect(this.riserFilter);
      o.start();
      this.riserOscs.push(o);
    }
    this.sub = ctx.createOscillator();
    this.sub.type = 'sine';
    this.sub.frequency.value = 32;
    this.subGain = ctx.createGain();
    this.subGain.gain.value = 0;
    this.sub.connect(this.subGain).connect(this.master);
    this.sub.start();
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  update(s: AudioState) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    if (t < this.duckUntil) return;
    const c = s.collapse;
    this.droneGain.gain.setTargetAtTime(0.13 * (1 - c * 0.5), t, 0.3);
    this.airGain.gain.setTargetAtTime(0.015 + Math.min(1, s.pointerSpeed * 0.25) * 0.09 + s.spin * 0.02, t, 0.12);
    this.airFilter.frequency.setTargetAtTime(500 + s.pointerSpeed * 300 + s.spin * 250, t, 0.2);
    for (const o of this.riserOscs) o.frequency.setTargetAtTime(38 + 150 * c * c, t, 0.1);
    this.riserFilter.frequency.setTargetAtTime(180 + 2600 * c * c, t, 0.1);
    this.riserGain.gain.setTargetAtTime(0.09 * Math.pow(c, 1.4), t, 0.1);
    this.sub.frequency.setTargetAtTime(30 + 18 * c, t, 0.2);
    this.subGain.gain.setTargetAtTime(0.32 * Math.max(c, s.hole * 0.35), t, 0.2);
  }

  explode(power: number) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    // broadband blast with a closing filter
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(9000, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 2.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.8 * power, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    src.connect(f).connect(g);
    g.connect(this.master);
    g.connect(this.wet);
    src.start(t);
    src.stop(t + 3.1);
    // sub kick
    const k = ctx.createOscillator();
    k.type = 'sine';
    k.frequency.setValueAtTime(150, t);
    k.frequency.exponentialRampToValueAtTime(26, t + 1.4);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.0001, t);
    kg.gain.exponentialRampToValueAtTime(1.0 * power, t + 0.01);
    kg.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    k.connect(kg).connect(this.master);
    k.start(t);
    k.stop(t + 1.9);
  }

  /** Collapse heartbeat: a felt, not heard, sub thump. */
  beat(strength: number) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(70 + strength * 30, t);
    o.frequency.exponentialRampToValueAtTime(34, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + 0.45 * strength, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.35);
  }

  /** The inhale before detonation: a reversed swell, then everything drops out. */
  implode(duration: number) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(5200, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45, t + duration * 0.95);
    g.gain.linearRampToValueAtTime(0, t + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.05);
    this.duckUntil = t + duration + 0.04;
    // duck the bed so the blast lands in silence
    for (const n of [this.droneGain, this.riserGain, this.subGain, this.airGain]) {
      n.gain.cancelScheduledValues(t);
      n.gain.setTargetAtTime(0, t, duration * 0.3);
    }
  }

  morph() {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    src.connect(f).connect(g);
    g.connect(this.master);
    g.connect(this.wet);
    src.start(t);
    src.stop(t + 1.9);
    // glassy chord, mostly reverb
    [523.25, 783.99, 1046.5, 1567.98].forEach((freq, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.004);
      const og = ctx.createGain();
      const s = t + i * 0.07;
      og.gain.setValueAtTime(0.0001, s);
      og.gain.exponentialRampToValueAtTime(0.035, s + 0.25);
      og.gain.exponentialRampToValueAtTime(0.0001, s + 2.4);
      o.connect(og).connect(this.wet);
      o.start(s);
      o.stop(s + 2.5);
    });
  }
}
