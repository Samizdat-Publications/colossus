// COLOSSUS landing page: the scroll-scrubbed rise, the fight's stage of clips, the fight recorder and the
// greybox-to-finished slider. Everything works without this script except the motion.
(function () {
  'use strict';
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = navigator.connection;
  const saveData = !!(conn && (conn.saveData || /(^|-)2g|3g/.test(conn.effectiveType || '')));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  const chapters = fetch('media/chapters.json').then((r) => r.json()).catch(() => null);

  // ---------------------------------------------------------------- top bar turns solid past the hero
  const bar = document.querySelector('.bar');
  const rise = document.querySelector('.rise');
  const onBar = () => bar.classList.toggle('solid', window.scrollY > rise.offsetHeight - window.innerHeight - 40);
  window.addEventListener('scroll', onBar, { passive: true });
  onBar();

  // ---------------------------------------------------------------- the ruin rises
  const canvas = document.getElementById('rise-canvas');
  const still = document.getElementById('rise-still');
  const ctx = canvas.getContext('2d');
  const letters = [...document.querySelectorAll('.wordmark span')];
  const ledes = [...document.querySelectorAll('.lede')];
  const cta = document.getElementById('rise-cta');
  const cue = document.getElementById('scroll-cue');
  const meter = document.getElementById('rise-meter');
  let frames = [];
  let shown = -1;
  let want = 0;
  let ticking = false;

  letters.forEach((l, i) => l.style.setProperty('--tilt', `${(i % 2 ? 1 : -1) * (4 + ((i * 7) % 5))}deg`));

  function progress() {
    const r = rise.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - window.innerHeight), 0, 1);
  }
  function sizeCanvas() {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    shown = -1;
  }
  /** the nearest frame that has loaded (frames stream in coarse to fine) */
  function nearest(i) {
    for (let d = 0; d < frames.length; d++) {
      if (frames[i - d]?.ok) return i - d;
      if (frames[i + d]?.ok) return i + d;
    }
    return -1;
  }
  function draw() {
    const i = nearest(want);
    if (i < 0 || i === shown) return;
    shown = i;
    const img = frames[i].img;
    const cw = canvas.width;
    const ch = canvas.height;
    // cover, anchored a little right of centre (the golem stands right of the text)
    const s = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * s;
    const h = img.naturalHeight * s;
    ctx.drawImage(img, (cw - w) * 0.62, (ch - h) * 0.5, w, h);
  }
  function scrub() {
    ticking = false;
    const p = progress();
    // hold the rubble for a moment, assemble over most of the scroll, hold the standing golem at the end
    const fp = clamp((p - 0.04) / 0.76, 0, 1);
    want = Math.round(fp * (frames.length - 1));
    draw();
    letters.forEach((l, i) => l.style.setProperty('--k', String(clamp((fp - (0.04 + i * 0.085)) / 0.2, 0, 1))));
    for (const l of ledes) l.classList.toggle('on', p >= Number(l.dataset.from) && p < Number(l.dataset.to));
    cta.classList.toggle('on', p > 0.8);
    cue.classList.toggle('gone', p > 0.02);
    meter.style.height = `${fp * 100}%`;
  }
  const requestScrub = () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(scrub);
    }
  };

  function startRise(n) {
    const src = (i) => `media/rise/r${String(i).padStart(2, '0')}.jpg`;
    if (reduced) {
      // no scrub: the standing golem, the words in place
      still.src = src(n - 1);
      letters.forEach((l) => l.style.setProperty('--k', '1'));
      return;
    }
    frames = Array.from({ length: n }, () => ({ img: null, ok: false }));
    // coarse to fine, so scrolling early still shows the right stage of the rise
    const order = [];
    for (const stride of [16, 8, 4, 2, 1]) for (let i = 0; i < n; i += stride) if (!order.includes(i)) order.push(i);
    if (!order.includes(n - 1)) order.splice(1, 0, n - 1);
    let next = 0;
    const load = () => {
      if (next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        frames[i] = { img, ok: true };
        if (i === 0) {
          sizeCanvas();
          rise.classList.add('live');
        }
        draw();
        load();
      };
      img.onerror = load;
      img.src = src(i);
    };
    // a few loaders in parallel
    for (let k = 0; k < 4; k++) load();
    window.addEventListener('scroll', requestScrub, { passive: true });
    window.addEventListener('resize', () => {
      sizeCanvas();
      requestScrub();
    });
    scrub();
  }
  fetch('media/rise.json')
    .then((r) => r.json())
    .then((d) => startRise(d.frames))
    .catch(() => startRise(96));

  // rain over the hero: fine slanted streaks, only while the hero is on screen
  (function rain() {
    const c = document.getElementById('rain');
    if (reduced || !c) return;
    const g = c.getContext('2d');
    let drops = [];
    let on = false;
    let last = 0;
    const slant = Math.tan((12 * Math.PI) / 180);
    const resize = () => {
      c.width = c.clientWidth;
      c.height = c.clientHeight;
      const n = Math.round((c.width * c.height) / 9000);
      drops = Array.from({ length: n }, () => ({ x: Math.random() * c.width * 1.2, y: Math.random() * c.height, l: 14 + Math.random() * 26, v: 900 + Math.random() * 700, a: 0.06 + Math.random() * 0.14 }));
    };
    const frame = (t) => {
      if (!on) return;
      const dt = Math.min(0.05, (t - last) / 1000 || 0.016);
      last = t;
      g.clearRect(0, 0, c.width, c.height);
      g.lineWidth = 1;
      for (const d of drops) {
        d.y += d.v * dt;
        d.x -= d.v * dt * slant;
        if (d.y > c.height + 40) {
          d.y = -40;
          d.x = Math.random() * c.width * 1.2;
        }
        g.strokeStyle = `rgba(205, 220, 240, ${d.a})`;
        g.beginPath();
        g.moveTo(d.x, d.y);
        g.lineTo(d.x + d.l * slant, d.y - d.l);
        g.stroke();
      }
      requestAnimationFrame(frame);
    };
    resize();
    window.addEventListener('resize', resize);
    new IntersectionObserver((es) => {
      const vis = es[0].isIntersecting;
      if (vis && !on) {
        on = true;
        last = performance.now();
        requestAnimationFrame(frame);
      } else if (!vis) on = false;
    }).observe(c);
  })();

  // ---------------------------------------------------------------- clips
  function makeVideo(name, label) {
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.preload = 'none';
    v.poster = `media/${name}.jpg`;
    v.setAttribute('aria-label', label);
    const s = document.createElement('source');
    s.src = `media/${name}.mp4`;
    s.type = 'video/mp4';
    v.appendChild(s);
    return v;
  }
  const play = (v) => {
    if (saveData || reduced) {
      v.controls = true;
      return;
    }
    if (v.preload === 'none') v.preload = 'auto';
    v.play().catch(() => (v.controls = true));
  };

  // the fight: one stage on wide screens, a clip under each step on narrow ones
  const steps = [...document.querySelectorAll('.step')];
  const shotsEl = document.getElementById('stage-shots');
  const cap = document.getElementById('stage-cap');
  const ticksEl = document.getElementById('stage-ticks');
  const wide = window.matchMedia('(min-width: 961px)');
  const shots = steps.map((li, i) => {
    const title = li.querySelector('h3').textContent;
    const shot = document.createElement('div');
    shot.className = 'shot';
    const v = makeVideo(li.dataset.clip, title);
    shot.appendChild(v);
    shotsEl.appendChild(shot);
    // the narrow-screen copy
    const fig = document.createElement('figure');
    fig.className = 'clip-inline';
    const vi = makeVideo(li.dataset.clip, title);
    vi.dataset.inview = '';
    fig.appendChild(vi);
    li.appendChild(fig);
    // a jump button per step
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-label', `Show: ${title}`);
    b.addEventListener('click', () => li.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' }));
    ticksEl.appendChild(b);
    return { li, shot, v, b, title };
  });
  let active = -1;
  function activate(i) {
    if (i === active || !wide.matches) return;
    const prev = shots[active];
    const cur = shots[i];
    steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
    shots.forEach((s, k) => s.b.setAttribute('aria-current', String(k === i)));
    if (prev) {
      prev.shot.classList.remove('is-active');
      prev.shot.classList.add('was-active');
      setTimeout(() => {
        prev.shot.classList.remove('was-active');
        if (active !== shots.indexOf(prev)) prev.v.pause();
      }, 720);
    }
    cur.shot.classList.add('is-active');
    play(cur.v);
    cap.textContent = `${cur.title}${cur.li.dataset.time ? `, ${cur.li.dataset.time}` : ''}`;
    active = i;
    // warm up the next clip
    const nx = shots[i + 1];
    if (nx && nx.v.preload === 'none' && !saveData) nx.v.preload = 'metadata';
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) activate(steps.indexOf(e.target));
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    steps.forEach((s) => io.observe(s));
  }
  wide.addEventListener('change', () => {
    active = -1;
  });

  // clips that play while they are on screen (narrow-screen steps, the losing clip)
  const inview = [...document.querySelectorAll('video[data-inview]')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          const v = e.target;
          if (!v.offsetParent) continue;
          if (e.isIntersecting) play(v);
          else v.pause();
        }
      },
      { threshold: 0.5 },
    );
    inview.forEach((v) => io.observe(v));
  }

  // ---------------------------------------------------------------- the fight recorder
  const run = document.getElementById('run');
  const bands = document.getElementById('tl-bands');
  const tl = document.getElementById('tl-ticks');
  const fill = document.getElementById('tl-fill');
  const now = document.getElementById('now');
  const tally = document.getElementById('tally');
  const kindColour = { start: 'var(--bone)', break: 'var(--core)', phase: 'var(--ember)', danger: '#ff6a45', end: 'var(--gold)' };

  // The static host ignores byte-range requests, so a browser cannot seek into the part of the video it has not
  // downloaded yet. The whole fight is fetched once into a local blob instead; after that, seeking is instant.
  let whole = null;
  let loadNote = '';
  function ensureWhole() {
    if (whole) return whole;
    const src = run.querySelector('source').src;
    whole = fetch(src)
      .then(async (r) => {
        const total = Number(r.headers.get('content-length')) || 0;
        const reader = r.body.getReader();
        const parts = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          got += value.length;
          if (total) {
            loadNote = `Loading the whole fight: ${Math.round((got / total) * 100)}%`;
            if (!run.currentTime) now.textContent = loadNote;
          }
        }
        return new Blob(parts, { type: 'video/mp4' });
      })
      .then((blob) => {
        const t = run.currentTime;
        const playing = !run.paused;
        run.src = URL.createObjectURL(blob);
        run.currentTime = t;
        if (playing) run.play().catch(() => undefined);
        loadNote = '';
        if (now.textContent.startsWith('Loading')) now.textContent = '';
      })
      .catch(() => {
        loadNote = '';
      });
    return whole;
  }
  if ('IntersectionObserver' in window && !saveData) {
    const near = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) {
        ensureWhole();
        near.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    near.observe(run);
  }
  run.addEventListener('play', () => ensureWhole(), { once: true });
  chapters.then((data) => {
    if (!data) return;
    const dur = data.duration;
    // step times: where each clip's moment falls in the whole fight
    const start = data.phases[0].from;
    for (const s of shots) {
      const t = data.clips?.[s.li.dataset.clip];
      if (t == null) continue;
      const label = `${mmss(Math.max(0, t - start))} into the fight`;
      s.li.dataset.time = label;
      const el = s.li.querySelector('.step-time');
      if (el) el.textContent = label;
    }
    if (active >= 0) cap.textContent = `${shots[active].title}, ${shots[active].li.dataset.time ?? ''}`;
    // phase bands
    const lead = document.createElement('span');
    lead.style.width = `${(start / dur) * 100}%`;
    bands.appendChild(lead);
    for (const p of data.phases) {
      const b = document.createElement('span');
      b.dataset.phase = String(p.n);
      b.style.width = `${((p.to - p.from) / dur) * 100}%`;
      bands.appendChild(b);
    }
    // moments
    const ticks = data.events.map((ev) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tick';
      b.style.left = `${(ev.t / dur) * 100}%`;
      b.style.setProperty('--c', kindColour[ev.kind] || 'var(--bone)');
      const at = mmss(Math.max(0, ev.t - start));
      const tip = document.createElement('span');
      tip.textContent = `${at} ${ev.label}`;
      // labels near either end open inward, so they never run off the page
      const f = ev.t / dur;
      if (f > 0.7) tip.className = 'to-left';
      else if (f < 0.2) tip.className = 'to-right';
      b.appendChild(tip);
      b.setAttribute('aria-label', `Jump to ${at}: ${ev.label}`);
      b.addEventListener('click', () => {
        if (loadNote) now.textContent = loadNote;
        ensureWhole().then(() => {
          run.currentTime = Math.max(0, ev.t - 1.5);
          run.play().catch(() => undefined);
        });
      });
      tl.appendChild(b);
      return { ev, b, at };
    });
    let last = null;
    const update = () => {
      const t = run.currentTime || 0;
      fill.style.width = `${clamp(t / dur, 0, 1) * 100}%`;
      let cur = null;
      for (const k of ticks) if (k.ev.t <= t + 0.05) cur = k;
      if (cur !== last) {
        last?.b.classList.remove('is-now');
        cur?.b.classList.add('is-now');
        last = cur;
        now.replaceChildren();
        if (cur) {
          const b = document.createElement('b');
          b.textContent = cur.ev.label;
          now.append(b, `, ${cur.at} into the fight.`);
        }
      }
    };
    run.addEventListener('timeupdate', update);
    run.addEventListener('seeked', update);
    update();
    const st = data.stats;
    if (st) {
      tally.textContent = `In this run the bot landed ${st.coreHits} core strikes, broke the golem ${st.breaks} ${st.breaks === 1 ? 'time' : 'times'}, dodged ${st.dodges} blows and was hit ${st.hitsTaken} times. The fight itself took ${mmss(st.fightSeconds)}.`;
    }
  });

  // ---------------------------------------------------------------- greybox to finished
  const cmp = document.getElementById('compare');
  const range = document.getElementById('cmp-range');
  const before = document.getElementById('cmp-before');
  const after = document.getElementById('cmp-after');
  const labelL = document.getElementById('cmp-label-l');
  const tabs = [...document.querySelectorAll('.compare-tabs [role=tab]')];
  const stageNames = { grey: 'Greybox, milestone 1', blender: 'First Blender models, milestone 2' };
  let beat = 'punish';
  let stage = 'grey';
  const setX = () => cmp.style.setProperty('--x', `${range.value}%`);
  range.addEventListener('input', setX);
  const swap = () => {
    before.src = `media/evo-${beat}-${stage}.jpg`;
    after.src = `media/evo-${beat}-final.jpg`;
    labelL.textContent = stageNames[stage];
  };
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.setAttribute('aria-selected', String(x === t)));
      beat = t.dataset.beat;
      swap();
    }),
  );
  document.querySelectorAll('input[name=cmp-stage]').forEach((r) =>
    r.addEventListener('change', () => {
      stage = r.value;
      swap();
    }),
  );
  setX();
})();
