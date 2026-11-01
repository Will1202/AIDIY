export interface PointerHandlers {
  move(ndcX: number, ndcY: number): void;
  leave(): void;
  gather(on: boolean): void;
  collapse(on: boolean): void;
  swipe(dir: -1 | 1): void;
  detonate(): void;
  /** Any deliberate interaction — used to stop the autopilot. */
  interact(): void;
}

/**
 * Mouse:  move = disturb · left hold = vortex · right hold = collapse (release detonates) · double-click = detonate
 * Touch:  drag = disturb/vortex · two fingers = collapse (lift to detonate) · fast horizontal flick = transform
 */
export class PointerInput {
  private touches = new Map<number, { x: number; y: number; t: number; x0: number; t0: number }>();
  private collapsing = false;

  constructor(private el: HTMLElement, private h: PointerHandlers) {
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') h.leave();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('dblclick', () => {
      h.interact();
      h.detonate();
    });
  }

  private ndc(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -(((e.clientY - r.top) / r.height) * 2 - 1) };
  }

  private onMove = (e: PointerEvent) => {
    const p = this.ndc(e);
    const tr = this.touches.get(e.pointerId);
    if (tr) {
      tr.x = e.clientX;
      tr.y = e.clientY;
      tr.t = performance.now();
    }
    if (e.pointerType !== 'touch' || this.touches.size === 1) this.h.move(p.x, p.y);
  };

  private onDown = (e: PointerEvent) => {
    this.h.interact();
    const p = this.ndc(e);
    this.h.move(p.x, p.y);
    if (e.pointerType === 'touch') {
      const now = performance.now();
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now, x0: e.clientX, t0: now });
      if (this.touches.size >= 2) {
        this.h.gather(false);
        if (!this.collapsing) {
          this.collapsing = true;
          this.h.collapse(true);
        }
      } else {
        this.h.gather(true);
      }
      return;
    }
    if (e.button === 0) this.h.gather(true);
    if (e.button === 2) {
      this.collapsing = true;
      this.h.collapse(true);
    }
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      const tr = this.touches.get(e.pointerId);
      this.touches.delete(e.pointerId);
      if (this.collapsing && this.touches.size === 0) {
        this.collapsing = false;
        this.h.collapse(false);
      } else if (tr && !this.collapsing) {
        const dt = performance.now() - tr.t0;
        const dx = tr.x - tr.x0;
        if (dt < 320 && Math.abs(dx) > Math.min(140, window.innerWidth * 0.22)) this.h.swipe(dx < 0 ? 1 : -1);
      }
      if (this.touches.size === 0) {
        this.h.gather(false);
        this.h.leave();
      }
      return;
    }
    if (e.button === 0) this.h.gather(false);
    if (e.button === 2 && this.collapsing) {
      this.collapsing = false;
      this.h.collapse(false);
    }
  };
}
