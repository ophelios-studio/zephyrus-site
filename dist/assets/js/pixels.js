(() => {
  'use strict';
  const canvas = document.querySelector('#pixel-canvas');
  const context = canvas?.getContext('2d');
  if (!context) return;
  const field = canvas.closest('.closing');
  const button = field.querySelector('[data-pixel-pause]');
  const ui = document.querySelector('#ui-strings')?.dataset || {};
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const raster = document.createElement('canvas');
  raster.width = 64; raster.height = 48;
  const ink = raster.getContext('2d');
  // Sample the exact brand path, cropped to the mark's drawing area.
  ink.scale(2, 2); ink.translate(-2, -6);
  ink.lineWidth = 2.4; ink.lineCap = 'round'; ink.lineJoin = 'round';
  ink.stroke(new Path2D('M5 9h25L7 27h24M5 15h17M14 21h17'));
  const bitmap = ink.getImageData(0, 0, 64, 48).data;
  const seeds = [];
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) {
    const alpha = bitmap[(y * 64 + x) * 4 + 3] / 255;
    if (alpha > .45) seeds.push({ x, y, alpha, phase: x * .31 + y * .17 });
  }
  let particles = [], width = 0, height = 0, cell = 0;
  let frame, visible = false, paused = false, last = 0, time = 0;
  const pointer = { x: -1000, y: -1000, vx: 0, vy: 0, until: 0 };

  function resize() {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mobile = width <= 600;
    cell = Math.min(width * (mobile ? .98 : .55), height * 1.05) / 64;
    const cx = width * (mobile ? .5 : .78), cy = height * (mobile ? .62 : .5);
    particles = seeds.map(seed => {
      const x = cx + (seed.x - 32) * cell, y = cy + (seed.y - 24) * cell;
      return { ...seed, x, y, homeX: x, homeY: y, vx: 0, vy: 0 };
    });
    draw(false, 0);
  }
  function draw(update, step) {
    context.clearRect(0, 0, width, height);
    const radius = Math.max(65, Math.min(width * .085, 140));
    const active = performance.now() < pointer.until;
    for (const p of particles) {
      if (update) {
        const dx = p.x - pointer.x, dy = p.y - pointer.y, distance = Math.hypot(dx, dy);
        if (active && distance < radius) {
          const force = (1 - distance / radius) * 5.5;
          p.vx += (dx / (distance || 1) * force + pointer.vx * .07) * step;
          p.vy += (dy / (distance || 1) * force + pointer.vy * .07) * step;
        }
        p.vx += (p.homeX - p.x) * .013 * step;
        p.vy += (p.homeY - p.y) * .013 * step;
        const damping = Math.pow(.87, step);
        p.vx *= damping; p.vy *= damping;
        p.x += p.vx * step; p.y += p.vy * step;
        if (!active && Math.hypot(p.x - p.homeX, p.y - p.homeY) < .15 && Math.hypot(p.vx, p.vy) < .04) {
          p.x = p.homeX; p.y = p.homeY; p.vx = p.vy = 0;
        }
      }
      const light = .16 + .075 * Math.sin(time * .8 + p.phase);
      context.fillStyle = `rgba(60, 85, 27, ${light * p.alpha})`;
      const size = Math.max(1.7, cell * .57);
      context.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
  }
  function tick(now) {
    frame = undefined;
    if (!visible || paused || document.hidden || motion.matches) return;
    const delta = now - last;
    if (delta >= 1000 / 30) {
      const step = Math.min(delta / (1000 / 60), 3);
      time += Math.min(delta / 1000, .05); last = now; draw(true, step);
    }
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    if (frame) cancelAnimationFrame(frame); frame = undefined;
    if (motion.matches) {
      particles.forEach(p => { p.x = p.homeX; p.y = p.homeY; p.vx = p.vy = 0; });
      time = 0; draw(false, 0);
    } else if (visible && !paused && !document.hidden) {
      last = performance.now(); frame = requestAnimationFrame(tick);
    }
  }
  function disturb(event) {
    if (motion.matches || paused) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    pointer.vx = Math.max(-25, Math.min(25, x - pointer.x));
    pointer.vy = Math.max(-25, Math.min(25, y - pointer.y));
    pointer.x = x; pointer.y = y; pointer.until = performance.now() + 220;
  }
  field.addEventListener('pointermove', disturb, { passive: true });
  field.addEventListener('pointerdown', disturb, { passive: true });
  field.addEventListener('pointerleave', event => { if (event.pointerType !== 'touch') pointer.until = 0; });
  button.addEventListener('click', () => {
    paused = !paused;
    button.setAttribute('aria-pressed', String(paused));
    button.setAttribute('aria-label', paused ? ui.resumeCta : ui.pauseCta);
    button.querySelector('.mono').textContent = paused ? ui.paused : ui.live;
    resume();
  });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume(); }).observe(canvas);
  document.addEventListener('visibilitychange', resume);
  motion.addEventListener('change', resume);
  resize();
})();
