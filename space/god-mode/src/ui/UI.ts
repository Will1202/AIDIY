import { FORMS } from '../app/Universe';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** Editorial chapter cards. Index FORM_COUNT = Genesis, FORM_COUNT + 1 = Supernova. */
const CHAPTERS: { num: string; title: string; line: string }[] = [
  { num: 'I', title: 'Galaxy', line: 'BARRED SPIRAL · 10¹¹ SUNS · 230 KM/S' },
  { num: 'II', title: 'Black Hole', line: 'EVENT HORIZON · ACCRETION AT 0.4 c' },
  { num: 'III', title: 'Helix', line: 'DNA · 3.2 × 10⁹ BASE PAIRS' },
  { num: 'IV', title: 'Nebula', line: 'STELLAR NURSERY · 10 000 K IONISED GAS' },
  { num: 'V', title: 'Singularity', line: 'INFINITE DENSITY · t = 0' },
  { num: '0', title: 'Genesis', line: 't = 10⁻⁴³ s · PLANCK EPOCH' },
  { num: '∞', title: 'Supernova', line: '10⁴⁴ JOULES · MATTER RETURNED TO LIGHT' },
];
export const CHAPTER_GENESIS = 5;
export const CHAPTER_SUPERNOVA = 6;

export interface UIHandlers {
  sound(): void;
  camera(): void;
  quality(): void;
  form(i: number): void;
  step(dir: number): void;
  holdStart(): void;
  holdEnd(): void;
}

/** Thin DOM layer: the cinematic HUD. Never blocks the canvas except its own controls. */
export class UI {
  readonly root = $('ui');
  readonly video = $<HTMLVideoElement>('cam-video');
  readonly overlay = $<HTMLCanvasElement>('cam-overlay');
  private items: HTMLLIElement[] = [];
  private hint = $('hint');
  private toastEl = $('toast');
  private toastTimer = 0;
  private telemetry = $('telemetry');
  private hold = $('hold');
  private holdLabel = $('hold-label');
  private lastTelemetry = 0;
  private chapterEl = $('chapter');
  private chapterTimer = 0;
  private reticle = $('reticle');
  private reticleLabel = this.reticle.querySelector('.r-label') as HTMLElement;

  constructor(h: UIHandlers) {
    const list = $('form-list');
    FORMS.forEach((name, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<b>${ROMAN[i]}</b>${name}`;
      li.addEventListener('click', () => h.form(i));
      list.appendChild(li);
      this.items.push(li);
    });
    $('prev').addEventListener('click', () => h.step(-1));
    $('next').addEventListener('click', () => h.step(1));
    $('btn-sound').addEventListener('click', () => h.sound());
    $('btn-camera').addEventListener('click', () => h.camera());
    $('btn-quality').addEventListener('click', () => h.quality());

    const down = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.hold.setPointerCapture(e.pointerId);
      this.hold.classList.add('on');
      h.holdStart();
    };
    const up = (e: PointerEvent) => {
      if (!this.hold.classList.contains('on')) return;
      e.stopPropagation();
      this.hold.classList.remove('on');
      h.holdEnd();
    };
    this.hold.addEventListener('pointerdown', down);
    this.hold.addEventListener('pointerup', up);
    this.hold.addEventListener('pointercancel', up);
    this.hold.addEventListener('contextmenu', (e) => e.preventDefault());
    // keep button presses from reaching the canvas handlers on window
    for (const b of this.root.querySelectorAll('button, li')) b.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  reveal() {
    this.root.classList.add('ready');
  }

  toggleHidden() {
    this.root.classList.toggle('hidden');
    return this.root.classList.contains('hidden');
  }

  showHint(on: boolean) {
    this.hint.classList.toggle('show', on);
  }

  setForm(active: number, from: number, progress: number) {
    this.items.forEach((li, i) => {
      li.classList.toggle('active', i === active);
      const p = i === active ? progress : i === from && progress < 1 ? 1 - progress : 0;
      li.style.setProperty('--p', p.toFixed(3));
    });
  }

  setToggle(id: 'btn-sound' | 'btn-camera' | 'btn-quality', on: boolean, value: string, busy = false) {
    const b = $(id);
    b.setAttribute('aria-pressed', String(on));
    b.classList.toggle('busy', busy);
    b.querySelector('em')!.textContent = value;
  }

  showCamera(on: boolean) {
    $('cam').classList.toggle('on', on);
  }

  setCamState(label: string) {
    $('cam-state').textContent = label;
  }

  setCharge(c: number, charging: boolean) {
    this.hold.style.setProperty('--c', c.toFixed(3));
    this.holdLabel.textContent = charging ? (c > 0.18 ? 'RELEASE · DETONATE' : 'COLLAPSING') : 'HOLD · COLLAPSE';
  }

  setTelemetry(now: number, particles: number, fps: number, gravity: number, mode: string) {
    if (now - this.lastTelemetry < 250) return;
    this.lastTelemetry = now;
    this.telemetry.innerHTML =
      `<b>PARTICLES</b>  ${particles.toLocaleString('en-US')}\n` +
      `<b>FRAMERATE</b>  ${fps.toFixed(0).padStart(3, ' ')} FPS\n` +
      `<b>GRAVITY  </b>  ${gravity.toFixed(2)}<span class="bar" style="--v:${gravity.toFixed(3)}"></span>\n` +
      `<b>CONTROL  </b>  ${mode}`;
  }

  /** Large serif title card that types itself in, holds, then dissolves glyph by glyph. */
  chapter(i: number) {
    const c = CHAPTERS[i];
    if (!c) return;
    const glyphs = [...c.title]
      .map((ch, k) => `<span style="--i:${k}">${ch === ' ' ? '&nbsp;' : ch}</span>`)
      .join('');
    this.chapterEl.classList.remove('out');
    this.chapterEl.innerHTML = `<div class="num">${c.num}</div><h2>${glyphs}</h2><p>${c.line}</p>`;
    clearTimeout(this.chapterTimer);
    this.chapterTimer = window.setTimeout(() => this.chapterEl.classList.add('out'), 3200);
  }

  /** The custom cursor: follows mouse or hand, tightens when gathering, shows charge. */
  setReticle(x: number, y: number, visible: boolean, gather: number, charge: number, charging: boolean) {
    const r = this.reticle;
    r.classList.toggle('on', visible);
    if (!visible) return;
    r.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    r.style.setProperty('--g', gather.toFixed(3));
    r.style.setProperty('--c', charge.toFixed(3));
    r.style.setProperty('--co', charge > 0.01 ? '1' : '0');
    const label = charging || charge > 0.01 ? `MASS ${(charge * 100).toFixed(0).padStart(3, ' ')}%` : gather > 0.5 ? 'GRAVITY WELL' : '';
    if (this.reticleLabel.textContent !== label) this.reticleLabel.textContent = label;
  }

  toast(msg: string, ms = 1800) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }
}
