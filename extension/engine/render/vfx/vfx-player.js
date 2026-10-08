import * as THREE from '../../../vendor/three.module.js';
import { advanceBakes, clearSessionBakes, disposeBakeSession, createBakeSession, beginBakeGeneration } from './vfx-bake.js';
import { createVfxContext } from './vfx-context.js';
import { setShaderTime } from './vfx-live-shader.js';
import { guardRenderer } from '../gl-manager.js';
import { keyOnAt } from './vfx-curve.js';
import { createPostChain, DOF_ENABLED } from './vfx-post.js';
import { createVfxCameraRig, battleDefaultCamera } from './vfx-camera.js';
import { createLayerChain } from './vfx-chain.js';
import { createFrameLoop } from './vfx-loop.js';
import { makeVfxEnv } from './vfx-lighting.js';
import { linearToGamma as L2G } from '../color.js';
import { createSceneVfx } from './vfx-scenegraph.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../../../core/game-screen.js';
import { DEFAULT_BLOOM } from './vfx-constants.js';
import { notePlayFailure } from './vfx-failures.js';

const noteFrameFailure = notePlayFailure;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createVfxPlayer(canvas, opt0) {
  const orbit = !!(opt0 && opt0.orbit);
  const stage = !!(opt0 && opt0.stage);
  const zoom0 = opt0 && Number(opt0.zoom) > 0 ? Number(opt0.zoom) : 1;
  const bgHex = opt0 && opt0.bg != null ? opt0.bg : 0x1b1f29;
  const bgColor = new THREE.Color().setRGB(((bgHex >> 16) & 255) / 255, ((bgHex >> 8) & 255) / 255, (bgHex & 255) / 255);
  let renderer = null,
    scene = null,
    loopCtl = null,
    playSpeed = 1,
    envRT = null,
    fx = null,
    pivot = null,
    grid = null,
    bloomThreshold = DEFAULT_BLOOM.threshold,
    bloomIntensity = DEFAULT_BLOOM.intensity,
    chromaIntensity = 0,
    dofBase = null,
    dofSolo = null,
    dofSoloKeys = null,
    dofParams = null,
    post = null,
    paused = false,
    glGuard = null,
    _ro = null,
    rng = null,
    cues = [],
    cueAt = 0;
  const vfx = createVfxContext();
  const _listeners = [];
  const on = (target, type, fn, opt) => {
    target.addEventListener(type, fn, opt);
    _listeners.push([target, type, fn, opt]);
  };
  const rig = createVfxCameraRig(canvas, { stage, orbit, zoom: zoom0, gameCamera: !!(opt0 && opt0.gameCamera) });
  const chain = createLayerChain({
    makeFx: (bytes, o) => createSceneVfx(bytes, { ...o, vfx, renderCamera: () => rig.camera }),
    mount: (g) => (orbit && pivot ? pivot.add(g) : scene.add(g)),
    unmount: (g) => (orbit && pivot ? pivot.remove(g) : scene.remove(g)),
    placeOf: (lk, f) => (typeof lk.placeOf === 'function' ? lk.placeOf(f) : null),
  });
  const leadLayer = () => chain.lead();
  const battleCam = !!(opt0 && opt0.battleCamera);
  const leadCam = () => chain.leadCam() || (battleCam && chain.count ? battleDefaultCamera() : null);
  const placeStageCamera = () => rig.place(leadCam(), chain.count > 1);
  const renderBloom = (opaqueBg) => {
    if (!post) post = createPostChain(renderer);
    const sinks = [];
    for (const l of chain.layers || []) if (l && l.fx && l.fx.needsDepth && l.fx.setDepthTexture) sinks.push(l.fx.setDepthTexture);
    const onDepth = sinks.length ? (tex) => { for (const f of sinks) f(tex); } : null;
    post.render(scene, rig.camera, rig.width, rig.height, { bg: opaqueBg, threshold: bloomThreshold, intensity: bloomIntensity, chroma: chromaIntensity, dof: dofParams, onDepth });
  };
  function seeded(fn) {
    if (!rng) return fn();
    const prev = Math.random;
    Math.random = rng;
    try {
      return fn();
    } finally {
      Math.random = prev;
    }
  }
  function dropRenderer() {
    if (loopCtl) loopCtl.stop();
    chain.dropAll();
    clearSessionBakes(vfx.bakes);
    fx = null;
    const g = glGuard;
    glGuard = null;
    if (g) g.dispose();
    renderer = null;
    scene = null;
    post = null;
    envRT = null;
    grid = null;
    extraRoot = null;
  }
  function ensure() {
    if (renderer) return true;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, premultipliedAlpha: false, antialias: true });
      rig.attach(renderer);
      renderer.setClearColor(0x000000, 0);
      if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.LinearSRGBColorSpace || THREE.NoColorSpace || 'srgb-linear';
      scene = new THREE.Scene();
      applyEnv();
      if (!_ro && typeof ResizeObserver === 'function' && canvas.parentElement) {
        _ro = new ResizeObserver(() => {
          if (!renderer) return;
          rig.fit();
          const before = rig.width + 'x' + rig.height;
          rig.resize();
          if (before === rig.width + 'x' + rig.height) return;
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
          if (!rig.gameCam) rig.stageAspect();
        });
        _ro.observe(canvas.parentElement);
      }
      glGuard = guardRenderer(renderer, { onLost: dropRenderer });
    } catch (e) {
      notePlayFailure('renderer', e);
      return false;
    }
    return true;
  }
  function stop() {
    if (loopCtl) loopCtl.stop();
    if (chain.count) {
      chain.dropAll();
      clearSessionBakes(vfx.bakes);
      if (pivot) {
        try {
          scene.remove(pivot);
        } catch (e) {}
      }
      fx = null;
      pivot = null;
    }
    if (renderer) renderer.clear();
    rng = null;
    cues = [];
    cueAt = 0;
  }
  function showIdle() {
    if (!ensure()) return;
    rig.fit();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    rig.sizeTo(canvas.clientWidth || GAME_WIDTH, canvas.clientHeight || GAME_HEIGHT);
    if (stage) {
      if (!rig.camera) rig.makeCamera();
      rig.ensureTarget(0, 1, 0);
      if (grid) grid.visible = true;
      if (!grid) {
        grid = new THREE.GridHelper(12, 24, 0x5a6274, 0x2c313e);
        if (grid.material) {
          grid.material.transparent = true;
          grid.material.opacity = 0.6;
        }
        scene.add(grid);
      }
      placeStageCamera();
    }
    if (!rig.camera) return;
    try {
      renderBloom(stage ? bgColor : undefined);
    } catch (e) {
      noteFrameFailure('renderBloom', e);
    }
  }
  function dispose() {
    stop();
    if (envRT) {
      try {
        envRT.dispose();
      } catch (e) {}
      envRT = null;
    }
    if (post) {
      try {
        post.dispose();
      } catch (e) {}
      post = null;
    }
    if (grid) {
      try {
        scene && scene.remove(grid);
        grid.geometry && grid.geometry.dispose();
        grid.material && grid.material.dispose();
      } catch (e) {}
      grid = null;
    }
    if (_ro) {
      try {
        _ro.disconnect();
      } catch (e) {}
      _ro = null;
    }
    for (const [t, ty, fn, opt] of _listeners) {
      try {
        t.removeEventListener(ty, fn, opt);
      } catch (e) {}
    }
    _listeners.length = 0;
    disposeBakeSession(vfx.bakes);
    vfx.bakes = createBakeSession();
    if (glGuard) {
      glGuard.dispose();
      glGuard = null;
    }
    renderer = null;
    scene = null;
    rig.clearCamera();
  }
  function play(source, durMs, opt) {
    if (!source || !ensure()) return;
    stop();
    beginBakeGeneration();
    rig.fit();
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    rig.sizeTo(canvas.clientWidth || GAME_WIDTH, canvas.clientHeight || GAME_HEIGHT);
    const deterministicSeed = !(opt && opt.deterministicSeed === false);
    rng = deterministicSeed ? mulberry32(0x9e3779b9) : null;
    const loop = !!(opt && opt.loop);
    const onEnd = opt && typeof opt.onEnd === 'function' ? opt.onEnd : null;
    if (stage) {
      rig.makeCamera();
      rig.ensureTarget(0, 1, 0);
      if (grid) grid.visible = true;
      if (!grid) {
        grid = new THREE.GridHelper(12, 24, 0x5a6274, 0x2c313e);
        if (grid.material) {
          grid.material.transparent = true;
          grid.material.opacity = 0.6;
        }
        scene.add(grid);
      }
    } else {
      rig.makeCamera();
      if (orbit) {
        pivot = new THREE.Group();
        scene.add(pivot);
        rig.setPivot(pivot);
        rig.applyOrbit();
      }
    }
    paused = !!(opt && opt.paused);
    rig.resetApplied();
    const links = (Array.isArray(source) ? source : [source]).filter((x) => x && x.bytes);
    if (!links.length) return;
    fx = seeded(() => chain.build(links, loop));
    if (!fx) {
      showIdle();
      if (onEnd)
        try {
          onEnd();
        } catch (e) {
          noteFrameFailure('onEnd', e);
        }
      return false;
    }
    if (opt && opt.gameCamera != null) rig.setGameCamera(!!opt.gameCamera, leadCam(), chain.count > 1);
    rig.fit();
    rig.resize();
    if (!rig.gameCam) rig.stageAspect();
    const pb = fx && fx.post && fx.post.bloom;
    bloomThreshold = pb ? pb.threshold : DEFAULT_BLOOM.threshold;
    bloomIntensity = pb ? pb.intensity : DEFAULT_BLOOM.intensity;
    const pc = fx && fx.post && fx.post.chromatic;
    chromaIntensity = pc && pc.intensity > 0 ? pc.intensity : 0;
    dofBase = (fx && fx.post && fx.post.dof) || null;
    dofSolo = (fx && fx.post && fx.post.dofSolo) || null;
    dofSoloKeys = dofSolo && dofSolo.path && fx.volumeGate ? fx.volumeGate(dofSolo.path) : null;
    dofParams = null;
    if (stage) {
      if (!rig.userAdjusted && fx.bounds) {
        rig.frame(fx.bounds);
      }
      placeStageCamera();
    }
    const rebuildFx = () => {
      fx = seeded(() => chain.rebuild(links, loop));
      cueAt = 0;
    };
    playSpeed = opt && Number(opt.speed) > 0 ? Number(opt.speed) : 1;
    const chainMs = chain.totalMs();
    const dataMs = Number(durMs) > 0 ? 0 : Math.round(chainMs);
    loopCtl = createFrameLoop({
      paused: () => paused,
      speed: () => playSpeed,
      stepSim: (simMs) => {
        seeded(() => chain.step(simMs, 1 / 60));
        try {
          const t = (simMs + 1000 / 60) / 1000;
          advanceBakes(vfx.bakes, t, 1 / 60, renderer);
          setShaderTime(renderer, t);
          dofParams = DOF_ENABLED ? (dofSolo && (dofSoloKeys ? keyOnAt(dofSoloKeys, t) : true) ? dofSolo : dofBase) : null;
        } catch (e) {
          noteFrameFailure('shaderTime', e);
        }
        for (const u of extraUpdaters) {
          try {
            u(1 / 60);
          } catch (e) {
            noteFrameFailure('extraUpdater', e);
          }
        }
        const now = (simMs + 1000 / 60) / 1000;
        while (cueAt < cues.length && cues[cueAt].t <= now) {
          const c = cues[cueAt++];
          try {
            c.run();
          } catch (e) {
            noteFrameFailure('cue', e);
          }
        }
      },
      render: (realDt) => {
        chain.updateMatrices();
        const lead = leadLayer();
        if (stage) {
          rig.advanceShake(realDt / 1000);
          if (grid && lead && lead.fx.hasBackgroundEvents) grid.visible = lead.fx.backgroundVisible();
          placeStageCamera();
          renderBloom(bgColor);
        } else renderBloom();
      },
      liveCount: () => chain.liveCount(),
      onRestart: rebuildFx,
      onEnd: () => {
        stop();
        if (onEnd)
          try {
            onEnd();
          } catch (e) {
            noteFrameFailure('onEnd', e);
          }
      },
      onError: (err) => {
        noteFrameFailure('frame', err);
        try {
          renderer.setRenderTarget(null);
        } catch (e) {}
        stop();
        if (onEnd)
          try {
            onEnd();
          } catch (e) {
            noteFrameFailure('onEnd', e);
          }
      },
    });
    loopCtl.start(loop, dataMs, durMs);
    return true;
  }
  const repaintIdle = () => {
    if ((loopCtl && loopCtl.running) || !renderer || !rig.camera) return;
    try {
      renderBloom(stage ? bgColor : undefined);
    } catch (e) {
      noteFrameFailure('renderBloom', e);
    }
  };
  if ((orbit || stage) && canvas) {
    let mode = 0,
      lx = 0,
      ly = 0;
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    on(canvas, 'contextmenu', (e) => e.preventDefault());
    on(canvas, 'pointerdown', (e) => {
      lx = e.clientX;
      ly = e.clientY;
      mode = e.button === 2 || e.button === 1 ? 2 : 1;
      canvas.style.cursor = mode === 2 ? 'move' : 'grabbing';
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (er) {}
    });
    const end = () => {
      mode = 0;
      canvas.style.cursor = 'grab';
    };
    on(canvas, 'pointerup', end);
    on(canvas, 'pointercancel', end);
    on(canvas, 'pointermove', (e) => {
      if (!mode) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      if (rig.gameCam) rig.breakGame();
      if (stage) {
        rig.dragStage(dx, dy, mode === 2);
        placeStageCamera();
      } else if (mode === 2) rig.dragPan(dx, dy);
      else rig.dragOrbit(dx, dy);
      repaintIdle();
    });
    on(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        if (rig.gameCam) rig.breakGame();
        if (stage) {
          rig.wheelStage(e.deltaY);
          placeStageCamera();
        } else rig.wheelOrbit(e.deltaY);
        repaintIdle();
      },
      { passive: false },
    );
  }
  let extraRoot = null;
  let extraUpdaters = [];
  const setExtraObjects = (objs, updaters) => {
    if (!ensure()) return false;
    if (!extraRoot) {
      extraRoot = new THREE.Group();
      scene.add(extraRoot);
    }
    for (let i = extraRoot.children.length - 1; i >= 0; i--) extraRoot.remove(extraRoot.children[i]);
    for (const o of objs || [])
      if (o) {
        extraRoot.add(o);
      }
    extraUpdaters = (updaters || []).filter((f) => typeof f === 'function');
    if (!(loopCtl && loopCtl.running)) {
      try {
        renderBloom(stage ? bgColor : undefined);
      } catch (e) {
        noteFrameFailure('renderBloom', e);
      }
    }
    return true;
  };
  const setGameCamera = (on) => rig.setGameCamera(on, leadCam(), chain.count > 1);
  const timeline = () => ({ starts: chain.starts(), fbxSlots: (fx && fx.fbxSlots) || [], motions: chain.events('motionEvents'), sounds: chain.events('soundEvents'), texts: chain.events('textEvents') });
  const setOnUserCamera = (fn) => rig.setOnUserCam(typeof fn === 'function' ? fn : null);
  const setPaused = (v) => {
    paused = !!v;
    return paused;
  };
  const isPaused = () => paused;
  const setCues = (list) => {
    cues = (list || []).filter((c) => c && typeof c.run === 'function' && Number.isFinite(c.t)).sort((a, b) => a.t - b.t);
    cueAt = 0;
  };
  const setSpeed = (v) => {
    playSpeed = Number(v) > 0 ? Number(v) : 1;
  };
  let envSrc = null,
    envRTSrc = null;
  const setEnvironment = (cube, avg, light) => {
    envSrc = cube || null;
    vfx.env = makeVfxEnv(cube, avg, light);
    if (avg) {
      for (const L of chain.layers)
        L.fx.group.traverse((o) => {
          const u = o.material && o.material.uniforms && o.material.uniforms.tpEnv;
          if (u && u.value && u.value.set) u.value.set(L2G(avg[0]), L2G(avg[1]), L2G(avg[2]));
        });
    }
    applyEnv();
  };
  function applyEnv() {
    if (!envSrc || !renderer || !scene) return;
    if (envRT && envRTSrc === envSrc && scene.environment === envRT.texture) return;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromCubemap(envSrc);
      pmrem.dispose();
      if (envRT) envRT.dispose();
      envRT = rt;
      envRTSrc = envSrc;
      scene.environment = rt.texture;
    } catch (e) {
      notePlayFailure('environment', e);
    }
  }
  return { play, stop, dispose, showIdle, setGameCamera, setOnUserCamera, setSpeed, setEnvironment, setPaused, isPaused, setCues, setExtraObjects, timeline };
}

