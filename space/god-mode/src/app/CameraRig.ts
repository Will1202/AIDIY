import * as THREE from 'three';
import { FORM_COUNT, type Universe } from './Universe';

/**
 * A "shot" is how a cinematographer would frame one form: lens, distance,
 * orbit angle, dutch tilt and where the subject sits in the frame (lens shift).
 */
interface Shot {
  dist: number; // × fit distance
  az: number; // orbit around Y (rad)
  el: number; // elevation (rad)
  roll: number; // dutch angle (rad)
  fov: number; // vertical FOV (deg)
  shiftX: number; // off-axis lens shift in NDC (subject off-centre without perspective skew)
  shiftY: number;
}

// Each form gets its own lens language instead of one centred orbit.
const SHOTS: Shot[] = [
  // GALAXY — wide 3/4 hero, subject pushed right to balance the title block
  { dist: 1.0, az: -0.18, el: 0.36, roll: -0.07, fov: 44, shiftX: 0.16, shiftY: -0.05 },
  // BLACK HOLE — long lens, near the disk plane, dead-centre icon
  { dist: 1.08, az: 0.0, el: 0.06, roll: 0.0, fov: 30, shiftX: 0.0, shiftY: 0.02 },
  // DNA — close, dutch-tilted, the helix cuts the frame diagonally
  { dist: 0.82, az: 0.55, el: 0.12, roll: 0.16, fov: 38, shiftX: -0.04, shiftY: 0.0 },
  // NEBULA — wide-angle, camera floating inside the gas
  { dist: 0.82, az: -0.7, el: 0.22, roll: -0.05, fov: 58, shiftX: 0.0, shiftY: 0.04 },
  // SINGULARITY — perfectly symmetrical, telephoto, confrontational
  { dist: 1.0, az: 0.0, el: 0.0, roll: 0.0, fov: 34, shiftX: 0.0, shiftY: 0.0 },
];

const KEYS: (keyof Shot)[] = ['dist', 'az', 'el', 'roll', 'fov', 'shiftX', 'shiftY'];

/** Critically damped spring — camera moves start and settle like a real dolly. */
class Spring {
  v = 0;
  constructor(public x: number) {}
  step(target: number, dt: number, halfLife: number) {
    const w = 2 / Math.max(halfLife, 1e-3);
    const x = this.x - target;
    const tmp = (this.v + w * x) * dt;
    const e = Math.exp(-w * dt);
    this.v = (this.v - w * tmp) * e;
    this.x = target + (x + tmp) * e;
    return this.x;
  }
}

export class CameraRig {
  private springs: Record<keyof Shot, Spring>;
  private kick = 0; // blast dolly-out
  private kickV = 0;
  /** 0..1 — how much the frame wants cinemascope bars right now. */
  letterbox = 0;
  /** Normalised push-in from the collapse heartbeat. */
  pulse = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    const s = SHOTS[0];
    this.springs = Object.fromEntries(KEYS.map((k) => [k, new Spring(s[k])])) as Record<keyof Shot, Spring>;
  }

  explode(power: number) {
    this.kickV += 2.6 * power;
  }

  update(u: Universe, dt: number, t: number, fit: number, parallax: THREE.Vector2, portrait: boolean, reduced: boolean) {
    // blend the shots of the forms currently on screen
    const target: Shot = { dist: 0, az: 0, el: 0, roll: 0, fov: 0, shiftX: 0, shiftY: 0 };
    let wsum = 0;
    for (let i = 0; i < FORM_COUNT; i++) {
      const w = u.formWeight(i);
      if (w <= 0) continue;
      wsum += w;
      for (const k of KEYS) target[k] += SHOTS[i][k] * w;
    }
    for (const k of KEYS) target[k] /= wsum || 1;
    if (portrait) {
      // a 9:16 frame has no room for lateral framing; tilt instead of shifting
      target.shiftX *= 0.2;
      target.roll *= 0.6;
      target.fov = Math.min(target.fov + 6, 66);
    }

    const c = u.collapse;
    const ce = c * c * (3 - 2 * c);
    // collapse: sink to the disk plane, roll slowly, and dolly-zoom (Vertigo):
    // the FOV opens while the camera pushes in, so space itself seems to stretch
    target.el = target.el * (1 - ce) + 0.07 * ce;
    target.roll += ce * 0.22 * Math.sin(t * 0.35);
    target.shiftX *= 1 - ce;
    target.shiftY *= 1 - ce;
    target.fov += ce * 26;
    target.dist *= 1 - 0.12 * ce;
    // implosion: a sharp breath in
    target.dist *= 1 - 0.18 * u.implode;
    target.fov -= 8 * u.implode;

    // birth: crane down from high above through the dust
    const b = u.birth;
    const be = 1 - Math.pow(1 - b, 3);
    target.dist *= 1 + 1.5 * (1 - be);
    target.el += 0.9 * (1 - be);
    target.roll += -0.25 * (1 - be);

    const halfLife = u.implode > 0 ? 0.08 : 0.9;
    const S = this.springs;
    const dist = S.dist.step(target.dist, dt, halfLife);
    const az = S.az.step(target.az + parallax.x * 0.12, dt, 1.1);
    const el = S.el.step(target.el + parallax.y * 0.08, dt, 1.1);
    const roll = S.roll.step(target.roll, dt, 1.3);
    const fov = S.fov.step(target.fov, dt, halfLife);
    const sx = S.shiftX.step(target.shiftX, dt, 1.4);
    const sy = S.shiftY.step(target.shiftY, dt, 1.4);

    // blast: the camera is thrown back, then drifts home on a soft spring
    this.kickV += (-this.kick * 14 - this.kickV * 5) * dt;
    this.kick += this.kickV * dt;

    // heartbeat push-in during collapse
    this.pulse = u.pulse;
    // `dist` is framing size, `fov` is perspective: distance compensates, so telephoto
    // shots compress space, wide shots exaggerate it, and an FOV ramp is a dolly-zoom
    const lens = Math.tan(THREE.MathUtils.degToRad(25)) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const R = fit * dist * lens * (1 + this.kick * 0.18 - u.pulse * 0.025 * c);

    // handheld operator: slow, layered, never mechanical
    const hh = reduced ? 0 : 1;
    const hAz = hh * (Math.sin(t * 0.13) * 0.035 + Math.sin(t * 0.071 + 1.3) * 0.025);
    const hEl = hh * (Math.sin(t * 0.097 + 0.4) * 0.025 + Math.sin(t * 0.041) * 0.02);
    const A = az + hAz;
    const E = el + hEl;

    const cam = this.camera;
    cam.position.set(Math.sin(A) * Math.cos(E) * R, Math.sin(E) * R, Math.cos(A) * Math.cos(E) * R);
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.rotateZ(roll + (reduced ? 0 : Math.sin(t * 0.17) * 0.01));
    if (!reduced && u.shake > 0.002) {
      const s = u.shake * u.shake * 0.3;
      cam.position.x += (Math.sin(t * 91.0) + Math.sin(t * 57.3)) * s;
      cam.position.y += (Math.sin(t * 77.7) + Math.sin(t * 43.1)) * s;
      cam.rotateZ(Math.sin(t * 63.0) * s * 0.06);
    }

    cam.fov = fov + this.kick * 9;
    cam.updateProjectionMatrix();
    // off-axis lens shift: move the subject in frame without skewing perspective
    const m = cam.projectionMatrix.elements;
    m[8] = -sx;
    m[9] = -sy;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld();

    // cinemascope bars arrive with the climax and leave with the recovery
    const want = portrait ? 0 : Math.max(smoothstep(0.25, 0.8, c), (1 - u.recover) * 1.0, u.implode);
    this.letterbox += (want - this.letterbox) * Math.min(1, dt * (want > this.letterbox ? 3.5 : 0.8));
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
