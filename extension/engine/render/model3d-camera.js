const PITCH_LIMIT = Math.PI / 2;

export function createModelCamera(T, camera, canvasEl, deps) {
  const { root, center, radius, rotationOverrideY } = deps;
  const state = { yaw: ((rotationOverrideY || 0) * Math.PI) / 180, pitch: 0.05, dist: radius * 2.2, target: center.clone() };
  camera.near = Math.max(0.01, radius / 1000);
  camera.far = Math.max(100, radius * 12);
  camera.updateProjectionMatrix();
  const applyCam = () => {
    camera.position.set(state.target.x, state.target.y, state.target.z + state.dist);
    camera.lookAt(state.target);
  };
  const applyRot = () => {
    root.rotation.set(state.pitch, state.yaw, 0);
    const rc = center.clone().applyEuler(root.rotation);
    root.position.copy(center).sub(rc);
  };
  applyCam();
  applyRot();

  let dragging = false,
    panning = false,
    lx = 0,
    ly = 0;
  canvasEl.style.touchAction = 'none';
  canvasEl.style.cursor = 'grab';
  canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
  canvasEl.addEventListener('pointerdown', (e) => {
    lx = e.clientX;
    ly = e.clientY;
    if (e.button === 2 || e.button === 1) {
      panning = true;
      canvasEl.style.cursor = 'move';
    } else {
      dragging = true;
      canvasEl.style.cursor = 'grabbing';
    }
    canvasEl.setPointerCapture(e.pointerId);
  });
  canvasEl.addEventListener('pointerup', (e) => {
    dragging = false;
    panning = false;
    canvasEl.style.cursor = 'grab';
    try {
      canvasEl.releasePointerCapture(e.pointerId);
    } catch (x) {}
  });
  canvasEl.addEventListener('pointermove', (e) => {
    const dx = e.clientX - lx,
      dy = e.clientY - ly;
    if (dragging) {
      state.yaw += dx * 0.01;
      state.pitch += dy * 0.01;
      state.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, state.pitch));
      lx = e.clientX;
      ly = e.clientY;
      applyRot();
    } else if (panning) {
      const panScale = state.dist * 0.0018;
      const right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
      state.target.addScaledVector(right, -dx * panScale);
      state.target.addScaledVector(up, dy * panScale);
      lx = e.clientX;
      ly = e.clientY;
      applyCam();
    }
  });
  canvasEl.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      state.dist *= 1 + Math.sign(e.deltaY) * 0.1;
      state.dist = Math.max(radius * 0.12, Math.min(radius * 8, state.dist));
      applyCam();
    },
    { passive: false },
  );

  return { state, apply: applyCam, applyRot };
}
