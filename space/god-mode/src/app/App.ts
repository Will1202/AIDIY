import * as THREE from 'three';
import { ParticleSim, createSharedUniforms } from '../gpu/ParticleSim';
import { ParticleField } from '../gpu/ParticleField';
import { Backdrop } from '../gpu/Backdrop';
import { PostFX } from '../gpu/PostFX';
import { Universe } from './Universe';
import { CameraRig } from './CameraRig';
import { DustLanes, Motes } from '../gpu/DepthLayers';
import { Director } from './Director';
import { QualityManager, TIERS } from './Quality';
import { PointerInput } from '../input/PointerInput';
import { HandTracker } from '../input/HandTracker';
import type { GestureState } from '../input/GestureClassifier';
import { AudioEngine } from '../audio/AudioEngine';
import { UI, CHAPTER_GENESIS, CHAPTER_SUPERNOVA } from '../ui/UI';

const BASE_FOV = 50;
const ORIGIN = new THREE.Vector3();
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class App {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 200);
  private shared = createSharedUniforms();
  private sim!: ParticleSim;
  private field!: ParticleField;
  private dust!: DustLanes;
  private motes = new Motes();
  private rig: CameraRig;
  private backdrop: Backdrop;
  private post: PostFX;
  private simType: THREE.TextureDataType;

  readonly universe = new Universe();
  private director: Director;
  private quality: QualityManager;
  private ui: UI;
  private audio = new AudioEngine();
  private hand: HandTracker;
  private handState: GestureState | null = null;
  private handPinching = false;

  // pointer bookkeeping (NDC)
  private userNdc = new THREE.Vector2();
  private userSeenAt = -99;
  private userInside = false;
  private userGather = false;
  private demoNdc: THREE.Vector2 | null = null;
  private demoGather = 0;
  private pointerWorld = new THREE.Vector3();
  private pointerPrev = new THREE.Vector3();
  private pointerVel = new THREE.Vector3();
  private pointerActive = 0;
  private gather = 0;
  private hasPointer = false;
  private raycaster = new THREE.Raycaster();
  private plane = new THREE.Plane();

  private clock = 0;
  private last = performance.now();
  private lastInteraction = -99;
  private fps = 60;
  private dpr = 1;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private isTouch = matchMedia('(pointer: coarse)').matches;
  private tmp = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = true;

    const ext = this.renderer.extensions;
    const floatRT = ext.has('EXT_color_buffer_float');
    const halfRT = floatRT || ext.has('EXT_color_buffer_half_float');
    this.simType = floatRT ? THREE.FloatType : THREE.HalfFloatType;
    const postType = halfRT ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.quality = new QualityManager((t) => this.applyTier(t, true), this.renderer.capabilities.maxTextureSize);
    const tier = TIERS[this.quality.tier];

    this.backdrop = new Backdrop(tier.octaves);
    this.scene.add(this.backdrop.group);
    this.scene.add(this.motes.points);
    this.rig = new CameraRig(this.camera);
    this.post = new PostFX(this.renderer, this.scene, this.camera, postType);

    this.ui = new UI({
      sound: () => this.toggleSound(),
      camera: () => this.toggleCamera(),
      quality: () => {
        this.quality.cycle();
        this.ui.setToggle('btn-quality', this.quality.mode !== 'auto', this.quality.label);
      },
      form: (i) => this.act(() => this.universe.setForm(i)),
      step: (d) => this.act(() => this.universe.step(d)),
      holdStart: () => this.act(() => this.universe.startCollapse('button')),
      holdEnd: () => this.universe.releaseCollapse('button', true),
    });
    this.ui.setToggle('btn-quality', false, this.quality.label);

    this.hand = new HandTracker(this.ui.video, this.ui.overlay, (s, e) => this.onHand(s, e));

    this.director = new Director({
      universe: this.universe,
      setDemoPointer: (ndc, g) => {
        this.demoNdc = ndc ? (this.demoNdc ?? new THREE.Vector2()).set(ndc.x, ndc.y) : null;
        this.demoGather = g;
      },
      rebirth: () => {
        this.universe.rebirth();
        this.sim.scatter();
        setTimeout(() => this.ui.chapter(CHAPTER_GENESIS), 900);
      },
    });

    this.universe.on('morph', (f) => {
      this.audio.morph();
      this.ui.chapter(f);
    });
    this.universe.on('implode', (d) => this.audio.implode(d));
    this.universe.on('beat', (c) => this.audio.beat(c));
    this.universe.on('explode', (p) => {
      this.audio.explode(p);
      this.rig.explode(p);
      this.motes.explode(p);
      if (this.isTouch && navigator.userActivation?.hasBeenActive) navigator.vibrate?.([30, 40, 90]);
      if (p > 0.55) setTimeout(() => this.ui.chapter(CHAPTER_SUPERNOVA), 700);
    });

    this.buildSim(tier.size);
    this.post.setTrails(tier.trails);
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ui.toast('GPU CONTEXT LOST · RELOADING', 4000);
      setTimeout(() => location.reload(), 1600);
    });
  }

  start() {
    this.director.start(true);
    setTimeout(() => this.ui.reveal(), 1300);
    setTimeout(() => this.ui.showHint(true), 5600);
    setTimeout(() => this.ui.showHint(false), 15000);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ── setup ──────────────────────────────────────────────────────────────────

  private buildSim(size: number) {
    if (this.sim) {
      this.scene.remove(this.field.points, this.dust.points);
      this.dust.dispose();
      this.field.dispose();
      this.sim.dispose();
    }
    this.sim = new ParticleSim(this.renderer, size, this.shared, this.simType);
    this.field = new ParticleField(this.sim, this.shared);
    this.dust = new DustLanes(this.field, this.shared, this.sim.count);
    this.scene.add(this.field.points, this.dust.points);
  }

  private applyTier(t: number, rebuild: boolean) {
    const tier = TIERS[t];
    if (rebuild && tier.size !== this.sim.size) {
      this.buildSim(tier.size);
      this.universe.regather();
    }
    this.post.setTrails(tier.trails);
    this.backdrop.setOctaves(tier.octaves);
    this.resize();
    this.ui.setToggle('btn-quality', this.quality.mode !== 'auto', this.quality.label);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w < 2 || h < 2) return; // hidden/minimised: keep the last good size
    const tier = TIERS[this.quality.tier];
    this.dpr = Math.min(window.devicePixelRatio || 1, tier.maxDpr);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h, this.dpr, tier.bloomScale);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.field.uniforms.uPixelRatio.value = this.dpr;
    this.field.uniforms.uViewScale.value = h / 1000;
    this.motes.uniforms.uPixelRatio.value = this.dpr;
    this.motes.uniforms.uViewScale.value = h / 1000;
    // DNA lies across a landscape frame and stands upright in a portrait one
    this.shared.uDnaTilt.value = w >= h ? 1.22 : 0.08;
  }

  private fitDistance() {
    const tanV = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    const tanH = tanV * this.camera.aspect;
    return Math.max(3.9 / tanV, 4.6 / tanH);
  }

  // ── input ──────────────────────────────────────────────────────────────────

  /** A deliberate interaction: take control away from the autopilot. */
  private interact() {
    this.lastInteraction = this.clock;
    if (this.director.active) {
      this.director.stop();
      this.ui.showHint(false);
    }
  }

  private act(fn: () => void) {
    this.interact();
    fn();
  }

  private bindInput() {
    new PointerInput(this.canvas, {
      move: (x, y) => {
        this.userNdc.set(x, y);
        this.userSeenAt = this.clock;
        this.userInside = true;
      },
      leave: () => (this.userInside = false),
      gather: (on) => {
        this.userGather = on;
        if (on) this.userSeenAt = this.clock;
      },
      collapse: (on) => (on ? this.universe.startCollapse('pointer') : this.universe.releaseCollapse('pointer', true)),
      swipe: (d) => this.act(() => this.universe.step(d)),
      detonate: () => this.universe.explode(),
      interact: () => this.interact(),
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight') return;
      const k = e.code;
      if (k === 'Space') {
        e.preventDefault();
        this.act(() => this.universe.startCollapse('key'));
      } else if (k === 'KeyE' || k === 'Enter') this.act(() => this.universe.explode());
      else if (k === 'ArrowRight' || k === 'KeyD') this.act(() => this.universe.step(1));
      else if (k === 'ArrowLeft' || k === 'KeyA') this.act(() => this.universe.step(-1));
      else if (/^Digit[1-5]$/.test(k)) this.act(() => this.universe.setForm(Number(k.slice(5)) - 1));
      else if (k === 'KeyH') this.ui.toast(this.ui.toggleHidden() ? 'UI HIDDEN · PRESS H' : 'UI VISIBLE', 1200);
      else if (k === 'KeyR') this.cinematic();
      else if (k === 'KeyM') this.toggleSound();
      else if (k === 'KeyC') this.toggleCamera();
      else if (k === 'KeyF') this.toggleFullscreen();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.universe.releaseCollapse('key', true);
    });
    window.addEventListener('blur', () => this.universe.cancelAllHolds());
  }

  /** R: replay the 30-second cinematic from the big bang — made for screen recording. */
  private cinematic() {
    this.universe.cancelAllHolds();
    this.ui.showHint(false);
    this.director.start(true);
    this.ui.toast('CINEMATIC · RECORDING TAKE', 1400);
  }

  private toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  private async toggleSound() {
    if (this.audio.enabled) {
      this.audio.disable();
      this.ui.setToggle('btn-sound', false, 'OFF');
    } else {
      await this.audio.enable();
      this.ui.setToggle('btn-sound', true, 'ON');
    }
  }

  private async toggleCamera() {
    if (this.hand.running) {
      this.hand.stop();
      this.ui.showCamera(false);
      this.ui.setToggle('btn-camera', false, 'OFF');
      return;
    }
    this.interact();
    try {
      this.ui.setToggle('btn-camera', false, '…', true);
      await this.hand.start((msg) => this.ui.setToggle('btn-camera', false, msg === 'LOADING HAND MODEL' ? 'LOADING' : '…', true));
      this.ui.setToggle('btn-camera', true, 'ON');
      this.ui.showCamera(true);
      this.ui.toast('PINCH · COLLAPSE   OPEN · DETONATE   SWIPE · TRANSFORM   FIST · VORTEX', 4200);
    } catch (err) {
      console.warn('[god-mode] camera', err);
      this.hand.stop();
      this.ui.setToggle('btn-camera', false, 'OFF');
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      this.ui.toast(denied ? 'CAMERA PERMISSION DENIED' : 'HAND TRACKING UNAVAILABLE · MOUSE & KEYS STILL WORK', 3200);
    }
  }

  private onHand(s: GestureState, e: { explode: boolean; swipe: -1 | 0 | 1 }) {
    this.handState = s.present ? s : null;
    this.ui.setCamState(s.label);
    if (s.present) this.interact();
    if (s.pinch && !this.handPinching) this.universe.startCollapse('hand');
    if (!s.pinch && this.handPinching) this.universe.releaseCollapse('hand', false);
    this.handPinching = s.pinch;
    if (e.explode) this.universe.explode();
    if (e.swipe) this.universe.step(e.swipe);
  }

  // ── frame ──────────────────────────────────────────────────────────────────

  private frame() {
    const now = performance.now();
    const rawDt = (now - this.last) / 1000;
    this.last = now;
    this.fps += (1 / Math.max(rawDt, 1e-3) - this.fps) * 0.05;
    this.quality.sample(rawDt);
    this.step(clamp(rawDt, 0.0005, 1 / 30), now);
  }

  /** Debug/QA: run the universe forward deterministically at a fixed step (e.g. `godMode.advance(8)`). */
  advance(seconds: number, fps = 60) {
    const n = Math.round(seconds * fps);
    for (let i = 0; i < n; i++) this.step(1 / fps, performance.now());
  }

  private step(dt: number, now: number) {
    this.clock += dt;

    // hand back to the autopilot after a quiet spell
    if (!this.director.active && !this.handState && !this.universe.charging && this.clock - this.lastInteraction > 16) {
      this.director.start(false);
    }
    this.director.update(dt);

    const u = this.universe;
    this.updatePointer(dt);
    if (!this.director.active) u.spinTarget = this.gather * 2.4;
    u.update(dt);
    const simDt = dt * u.timeScale;
    this.updateCamera(dt);
    this.motes.update(simDt, this.clock, u.implode);
    this.updateUniforms(simDt);

    this.sim.compute();
    this.field.bind(this.sim);
    this.shared.uBlast.value = 0;
    u.blastImpulse = 0;

    this.post.render(dt);

    this.audio.update({
      collapse: u.collapse,
      spin: u.spinBoost / 2.4,
      pointerSpeed: this.pointerVel.length() * 0.2 * this.pointerActive,
      hole: u.holeStrength,
    });
    this.ui.setForm(u.formB, u.formA, u.morph);
    const showReticle = this.hasPointer && (!!this.handState || (this.userInside && !this.director.active) || this.userGather);
    const rp = this.tmp.copy(this.pointerWorld).project(this.camera);
    this.ui.setReticle(
      (rp.x * 0.5 + 0.5) * window.innerWidth,
      (-rp.y * 0.5 + 0.5) * window.innerHeight,
      showReticle && !this.isTouch,
      this.gather,
      u.collapse,
      u.charging,
    );
    this.ui.setCharge(u.collapse, u.charging);
    this.ui.setTelemetry(
      now,
      this.sim.count,
      this.fps,
      u.collapse,
      this.director.active ? 'AUTOPILOT' : this.handState ? 'HAND' : 'MANUAL',
    );
  }

  private updatePointer(dt: number) {
    let ndc: THREE.Vector2 | null = null;
    let gather = 0;
    if (this.handState) {
      ndc = this.tmpNdc.set(
        clamp((this.handState.x - 0.5) / 0.38, -1, 1),
        clamp(-(this.handState.y - 0.5) / 0.34, -1, 1),
      );
      gather = this.handState.label === 'FIST' ? 1 : 0;
    } else if (this.userGather || (this.userInside && this.clock - this.userSeenAt < 2.5)) {
      ndc = this.userNdc;
      gather = this.userGather ? 1 : 0;
    } else if (this.director.active && this.demoNdc) {
      ndc = this.demoNdc;
      gather = this.demoGather;
    }
    this.gather += (gather - this.gather) * Math.min(1, dt * 4);

    if (ndc) {
      this.raycaster.setFromCamera(ndc, this.camera);
      this.camera.getWorldDirection(this.tmp);
      this.plane.setFromNormalAndCoplanarPoint(this.tmp, ORIGIN);
      const hit = this.raycaster.ray.intersectPlane(this.plane, this.tmp);
      if (hit) {
        if (!this.hasPointer) this.pointerPrev.copy(hit);
        this.pointerWorld.lerp(hit, this.hasPointer ? Math.min(1, dt * 18) : 1);
        this.hasPointer = true;
      }
    } else {
      this.hasPointer = false;
    }
    const v = this.tmp.subVectors(this.pointerWorld, this.pointerPrev).divideScalar(Math.max(dt, 1e-3));
    this.pointerVel.lerp(v.clampLength(0, 40), Math.min(1, dt * 10));
    this.pointerPrev.copy(this.pointerWorld);
    const target = this.hasPointer ? 0.12 + 0.88 * Math.min(1, this.pointerVel.length() / 6) : 0;
    this.pointerActive += (target - this.pointerActive) * Math.min(1, dt * 6);
  }
  private tmpNdc = new THREE.Vector2();

  private updateCamera(dt: number) {
    const fit = this.fitDistance();
    const par = this.hasPointer && !this.director.active ? this.userNdc : this.tmpNdc.set(0, 0);
    const portrait = this.camera.aspect < 0.9;
    this.rig.update(this.universe, dt, this.clock, Number.isFinite(fit) ? fit : 9, par, portrait, this.reducedMotion);
  }

  private updateUniforms(dt: number) {
    const u = this.universe;
    const S = this.shared;
    const cam = this.camera;
    S.uTime.value = this.clock;
    S.uDt.value = dt;
    S.uGalaxyAngle.value = u.galaxyAngle;
    S.uDiskTime.value = u.diskTime;
    S.uDnaAngle.value = u.dnaAngle;
    S.uMorph.value = u.morph;
    S.uFormA.value = u.formA;
    S.uFormB.value = u.formB;
    S.uBirth.value = u.birth;
    S.uRecover.value = u.recover;
    S.uSpring.value = 5.0 - u.formWeight(3) * 1.4;
    S.uDamp.value = (1.35 + 1.45 * u.recover) * (0.55 + 0.45 * u.birth);
    S.uTurb.value = 0.12 + u.formWeight(3) * 0.55;
    S.uCollapse.value = u.collapse;
    S.uConsume.value = u.consume;
    S.uHorizon.value = u.horizonRadius * 0.95;
    S.uBlast.value = u.blastImpulse;
    S.uImplode.value = u.implode;
    cam.getWorldDirection(S.uCamDir.value);
    S.uPointer.value.copy(this.pointerWorld);
    S.uPointerVel.value.copy(this.pointerVel).multiplyScalar(0.12);
    S.uPointerActive.value = this.pointerActive;
    S.uGather.value = this.gather;

    // where the singularity sits on screen, and how big its shadow is
    const viewOrigin = this.tmp.copy(ORIGIN).applyMatrix4(cam.matrixWorldInverse);
    this.field.uniforms.uHoleViewZ.value = viewOrigin.z;
    this.field.uniforms.uEnergy.value = u.flash * 0.2 + u.pulse * 0.3;
    // optics: focus on the subject; the wide nebula shot opens the aperture
    const focus = cam.position.length();
    const aperture = 1.0 + u.formWeight(3) * 0.9 + u.collapse * 0.5;
    const F0 = this.field.uniforms;
    F0.uFocusDist.value = focus;
    F0.uAperture.value = aperture;
    F0.uSpikes.value = (1 - u.formWeight(1)) * (1 - u.collapse) * u.recover;
    this.motes.uniforms.uFocusDist.value = focus;
    this.motes.uniforms.uAperture.value = aperture;
    this.motes.uniforms.uIntensity.value = smooth(0.2, 1, u.birth);
    this.dust.uniforms.uDust.value = (u.formWeight(0) + u.formWeight(3) * 0.6) * u.recover * (1 - u.collapse) * u.birth;
    const proj = this.tmp.copy(ORIGIN).project(cam);
    const L = this.post.lens.uniforms;
    L.uCenter.value.set(proj.x * 0.5 + 0.5, proj.y * 0.5 + 0.5);
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    L.uRs.value = (u.horizonRadius * (1 + u.pulse * 0.06)) / (2 * cam.position.length() * tanV);
    L.uStrength.value = u.holeStrength;
    // the hand's own gravity well
    if (this.hasPointer && this.gather > 0.01) {
      const pp = this.tmp.copy(this.pointerWorld).project(cam);
      L.uPtr.value.set(pp.x * 0.5 + 0.5, pp.y * 0.5 + 0.5);
    }
    L.uPtrStr.value = this.hasPointer ? this.gather : 0;
    L.uShockR.value = u.shockR;
    L.uShockAmp.value = u.shockAmp;
    L.uTime.value = this.clock;

    this.post.trail.damp = clamp(0.6 + 0.12 * (u.spinBoost / 2.4) + 0.2 * (1 - u.recover) * (1 - u.flash) + 0.12 * u.collapse, 0, 0.88);
    this.post.bloom.strength = 0.62 + u.collapse * 0.3 + u.flash * 0.5;
    const F = this.post.final.uniforms;
    F.uExposure.value = smooth(0, 2.2, this.clock) * (1 + u.collapse * 0.15);
    F.uFlash.value = u.flash * u.flash * 0.6;
    F.uTime.value = this.clock;
    F.uAberration.value = 0.012 + u.shockAmp * 0.05 + u.collapse * 0.02;
    F.uFlare.value = 0.16 + u.collapse * 0.3 + u.flash * 0.9 + u.holeStrength * 0.15 + u.pulse * 0.35;
    F.uLetterbox.value = this.rig.letterbox;
    F.uImplode.value = u.implode;

    this.backdrop.update(cam, this.clock, smooth(0.3, 3.0, this.clock), this.dpr);
  }
}

