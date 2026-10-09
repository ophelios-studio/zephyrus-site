(() => {
  'use strict';
  const canvas = document.querySelector('#wind-canvas');
  if (!canvas) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let width, height, frame, visible = true, paused = false, last = 0, elapsed = 0;
  let pointerX = 0, pointerY = 0, smoothX = 0, smoothY = 0;
  const TAU = Math.PI * 2, strands = 65, steps = 230;
  const field = canvas.parentElement;
  const pauseButton = document.querySelector('[data-wind-pause]');
  const ui = document.querySelector('#ui-strings')?.dataset || {};

  function resize() {
    const rect = canvas.getBoundingClientRect(); width = rect.width; height = rect.height;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0); draw(elapsed);
  }
  function project(t, v, time) {
    // A ruled ribbon folded through three dimensions, woven from individual threads.
    const bend = .12 * Math.sin(time * .6);
    const radius = 1.2 + .14 * Math.sin(t * 3 + time * .4);
    const twist = t * 1.5 + .35;
    let x = radius * Math.cos(t) + v * Math.cos(t) * Math.cos(twist);
    let y = 1.43 * Math.sin(t) + v * Math.sin(t) * Math.cos(twist);
    let z = .67 * Math.sin(2 * t + bend) + v * Math.sin(twist);
    const yaw = -.45 + Math.sin(time * .25) * .22 + smoothX * .16;
    const pitch = .24 + smoothY * .12;
    const x1 = x * Math.cos(yaw) + z * Math.sin(yaw);
    z = -x * Math.sin(yaw) + z * Math.cos(yaw); x = x1;
    const y1 = y * Math.cos(pitch) - z * Math.sin(pitch);
    z = y * Math.sin(pitch) + z * Math.cos(pitch); y = y1;
    const roll = -.48;
    const x2 = x * Math.cos(roll) - y * Math.sin(roll);
    y = x * Math.sin(roll) + y * Math.cos(roll); x = x2;
    const perspective = 4.8 / (4.8 + z);
    const scale = Math.min(width * .277, height * .235);
    return { x: width * .54 + x * scale * perspective, y: height * .50 + y * scale * perspective, z };
  }
  function draw(time) {
    context.clearRect(0, 0, width, height);
    smoothX += (pointerX - smoothX) * .035; smoothY += (pointerY - smoothY) * .035;
    // Subtle drafting guides give the sculpture a physical frame.
    context.lineWidth = .5; context.strokeStyle = 'rgba(176,204,150,.08)';
    context.beginPath(); context.moveTo(width * .54, 36); context.lineTo(width * .54, height - 38); context.moveTo(30, height * .50); context.lineTo(width - 25, height * .50); context.stroke();
    const lines = [];
    for (let i = 0; i < strands; i++) {
      const v = (i / (strands - 1) - .5) * .88;
      const points = [];
      for (let j = 0; j <= steps; j++) points.push(project(j / steps * TAU, v, time));
      lines.push(points);
    }
    for (let i = 0; i < strands; i++) {
      const points = lines[i];
      const alpha = .22 + .37 * Math.pow(Math.sin(i / strands * Math.PI), .65);
      const gradient = context.createLinearGradient(width * .2, height * .1, width * .8, height * .8);
      gradient.addColorStop(0, 'rgba(225,251,181,' + alpha + ')');
      gradient.addColorStop(.45, 'rgba(181,214,126,' + (alpha * .65) + ')');
      gradient.addColorStop(.8, 'rgba(210,246,162,' + (alpha * .92) + ')');
      gradient.addColorStop(1, 'rgba(119,163,83,' + (alpha * .38) + ')');
      context.strokeStyle = gradient; context.lineWidth = i === 0 || i === strands - 1 ? 1 : .62;
      context.beginPath(); points.forEach((point, j) => { if (j) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y); }); context.stroke();
    }
    // Cross threads accent the turns and expose the surface of the ribbon.
    context.lineWidth = .45;
    for (let j = 0; j < steps; j += 4) {
      const depth = lines[32][j].z;
      context.strokeStyle = 'rgba(202,237,157,' + (.06 + (1.5 - depth) * .032) + ')';
      context.beginPath(); lines.forEach((line, i) => { if (i) context.lineTo(line[j].x, line[j].y); else context.moveTo(line[j].x, line[j].y); }); context.stroke();
    }
    for (let n = 0; n < 3; n++) {
      const t = ((time * .13 + n * 2.09) % TAU);
      const point = project(t, n === 1 ? .43 : -.43, time);
      context.fillStyle = 'rgba(225,255,188,.9)'; context.beginPath(); context.arc(point.x, point.y, 1.4, 0, TAU); context.fill();
    }
  }
  function tick(now) {
    frame = undefined;
    if (paused || !visible || document.hidden || motion.matches) return;
    if (now - last >= 1000 / 30) { elapsed += Math.min((now - last) / 1000, .05); last = now; draw(elapsed); }
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    if (frame) cancelAnimationFrame(frame); frame = undefined;
    if (!paused && visible && !document.hidden && !motion.matches) { last = performance.now(); frame = requestAnimationFrame(tick); }
    else draw(elapsed);
  }
  field.addEventListener('pointermove', event => { const rect = field.getBoundingClientRect(); pointerX = (event.clientX - rect.left) / rect.width - .5; pointerY = (event.clientY - rect.top) / rect.height - .5; });
  field.addEventListener('pointerleave', () => { pointerX = pointerY = 0; });
  pauseButton?.addEventListener('click', () => {
    paused = !paused; pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.setAttribute('aria-label', paused ? ui.resume : ui.pause);
    pauseButton.querySelector('.mono').textContent = paused ? ui.paused : ui.live; resume();
  });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; resume(); }).observe(canvas);
  document.addEventListener('visibilitychange', resume); motion.addEventListener('change', resume);
  resize(); resume();
})();
