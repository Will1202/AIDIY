import { describe, expect, it } from 'vitest';
import { GestureClassifier, type Landmark } from '../src/input/GestureClassifier';

type Pose = 'open' | 'fist' | 'pinch';

/** Synthetic 21-point hand (image space, y down) centred at (cx, cy). */
function hand(pose: Pose, cx = 0.5, cy = 0.5): Landmark[] {
  const L: Landmark[] = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0 }));
  const set = (i: number, x: number, y: number) => (L[i] = { x: cx + x, y: cy + y, z: 0 });
  set(0, 0, 0.15); // wrist
  const cols = [-0.045, -0.015, 0.015, 0.045];
  [5, 9, 13, 17].forEach((mcp, f) => {
    const x = cols[f];
    set(mcp, x, 0);
    if (pose === 'open') {
      set(mcp + 1, x, -0.06);
      set(mcp + 2, x, -0.1);
      set(mcp + 3, x, -0.14);
    } else {
      set(mcp + 1, x, -0.04);
      set(mcp + 2, x, -0.01);
      set(mcp + 3, x, 0.03);
    }
  });
  if (pose === 'pinch') {
    // index curls to meet the thumb
    set(6, -0.05, -0.05);
    set(7, -0.06, -0.06);
    set(8, -0.07, -0.05);
    set(1, -0.06, 0.1);
    set(2, -0.08, 0.05);
    set(3, -0.08, 0.0);
    set(4, -0.072, -0.048);
  } else {
    set(1, -0.06, 0.1);
    set(2, -0.1, 0.06);
    set(3, -0.13, 0.03);
    set(4, -0.16, 0.0);
  }
  return L;
}

const run = (g: GestureClassifier, pose: Pose, t0: number, frames: number, cx = 0.5, dt = 1 / 30) => {
  let last = g.update(hand(pose, cx), 0.95, t0);
  const all = [last];
  for (let i = 1; i < frames; i++) {
    last = g.update(hand(pose, cx), 0.95, t0 + i * dt);
    all.push(last);
  }
  return { last, all, t: t0 + frames * dt };
};

describe('GestureClassifier', () => {
  it('recognises an open palm without firing a detonation on entry', () => {
    const g = new GestureClassifier({ aspect: 1 });
    const { last, all } = run(g, 'open', 0, 10);
    expect(last.state.label).toBe('OPEN');
    expect(all.some((r) => r.events.explode)).toBe(false);
  });

  it('detects a stable pinch', () => {
    const g = new GestureClassifier({ aspect: 1 });
    const { last } = run(g, 'pinch', 0, 10);
    expect(last.state.pinch).toBe(true);
  });

  it('ignores a single-frame pinch flicker', () => {
    const g = new GestureClassifier({ aspect: 1 });
    let t = run(g, 'open', 0, 8).t;
    const r = g.update(hand('pinch'), 0.95, t);
    t += 1 / 30;
    expect(r.state.pinch).toBe(false);
    const after = run(g, 'open', t, 4);
    expect(after.all.some((x) => x.state.pinch)).toBe(false);
  });

  it('pinch → open palm detonates exactly once', () => {
    const g = new GestureClassifier({ aspect: 1 });
    let t = run(g, 'pinch', 0, 10).t;
    const { all } = run(g, 'open', t, 12);
    t += 12 / 30;
    expect(all.filter((r) => r.events.explode).length).toBe(1);
  });

  it('respects the detonation cooldown', () => {
    const g = new GestureClassifier({ aspect: 1, explodeCooldown: 5 });
    let t = run(g, 'fist', 0, 6).t;
    let n = run(g, 'open', t, 8);
    t = n.t;
    let count = n.all.filter((r) => r.events.explode).length;
    t = run(g, 'fist', t, 6).t;
    n = run(g, 'open', t, 8);
    count += n.all.filter((r) => r.events.explode).length;
    expect(count).toBe(1);
  });

  it('detects a horizontal swipe in mirrored space', () => {
    const g = new GestureClassifier({ aspect: 1 });
    let t = run(g, 'open', 0, 6, 0.75).t;
    const swipes: number[] = [];
    // raw x moves 0.75 → 0.25 (hand moves to the user's right in the selfie view)
    for (let i = 0; i <= 8; i++) {
      const r = g.update(hand('open', 0.75 - i * 0.0625), 0.95, t);
      t += 1 / 30;
      if (r.events.swipe) swipes.push(r.events.swipe);
    }
    expect(swipes).toEqual([1]);
  });

  it('drops low-confidence frames and resets after losing the hand', () => {
    const g = new GestureClassifier({ aspect: 1 });
    const t = run(g, 'pinch', 0, 10).t;
    expect(g.update(hand('pinch'), 0.2, t).state.pinch).toBe(true); // brief dropout tolerated
    expect(g.update(null, 0, t + 1).state.present).toBe(false);
  });
});
