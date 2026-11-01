/**
 * Canvas-2D fallback for devices without WebGL2 / float render targets.
 * A small spiral galaxy that still reacts to the pointer, collapses and detonates.
 */
export function startLiteMode(canvas: HTMLCanvasElement, reason: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const note = document.getElementById('lite');
  if (note) {
    note.textContent = `LITE MODE · ${reason} · HOLD TO COLLAPSE · RELEASE TO DETONATE`;
    note.classList.add('on');
  }
  document.getElementById('ui')?.classList.add('ready');
  document.querySelectorAll<HTMLElement>('.controls, .forms, .hold, .telemetry, .hint').forEach((e) => (e.style.display = 'none'));

  const N = 2600;
  const px = new Float32Array(N), py = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
  const tr = new Float32Array(N), ta = new Float32Array(N), hue = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = 0.04 - Math.log(1 - Math.random() * 0.98) * 0.12;
    const arm = (i & 1) * Math.PI;
    tr[i] = r;
    ta[i] = arm + Math.log(r / 0.04 + 1) * 3 + (Math.random() - 0.5) * 0.6;
    hue[i] = Math.random() < 0.25 || r < 0.12 ? 1 : 0;
    px[i] = (Math.random() - 0.5) * 2;
    py[i] = (Math.random() - 0.5) * 2;
  }
  let mx = 9, my = 9, holding = false, collapse = 0, recover = 1, angle = 0;
  const toLocal = (e: PointerEvent) => {
    const s = Math.min(innerWidth, innerHeight);
    mx = (e.clientX - innerWidth / 2) / s;
    my = (e.clientY - innerHeight / 2) / s;
  };
  canvas.addEventListener('pointermove', toLocal);
  canvas.addEventListener('pointerdown', (e) => { toLocal(e); holding = true; });
  addEventListener('pointerup', () => {
    if (holding && collapse > 0.2) {
      for (let i = 0; i < N; i++) {
        const a = Math.random() * Math.PI * 2, s = (0.5 + Math.random() * 2.5) * collapse;
        vx[i] = Math.cos(a) * s;
        vy[i] = Math.sin(a) * s;
      }
      recover = 0;
    }
    holding = false;
  });

  let last = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== innerWidth * dpr) { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; }
    const W = canvas.width, H = canvas.height, S = Math.min(W, H);
    collapse = holding ? Math.min(1, collapse + dt * 0.3) : Math.max(0, collapse - dt * 0.5);
    recover = Math.min(1, recover + dt * 0.3);
    angle += dt * (0.15 + collapse * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const r = tr[i] * (1 - collapse * 0.8), a = ta[i] + angle * (collapse > 0 ? 1 + 0.3 / (r + 0.05) : 1);
      const tx = Math.cos(a) * r, ty = Math.sin(a) * r * 0.55;
      const k = 4 * recover;
      vx[i] += ((tx - px[i]) * k - vx[i] * 1.6) * dt;
      vy[i] += ((ty - py[i]) * k - vy[i] * 1.6) * dt;
      const dx = px[i] - mx, dy = py[i] - my, d2 = dx * dx + dy * dy + 1e-4;
      if (d2 < 0.02) { vx[i] += (dx / d2) * 0.004; vy[i] += (dy / d2) * 0.004; }
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      ctx.fillStyle = hue[i] ? 'rgba(255,205,140,0.55)' : 'rgba(150,200,255,0.5)';
      ctx.fillRect(W / 2 + px[i] * S, H / 2 + py[i] * S, 1.4 * dpr, 1.4 * dpr);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
