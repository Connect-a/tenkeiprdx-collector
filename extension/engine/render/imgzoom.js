import { el } from '../../core/dom.js';

const shortPath = (p) => {
  if (!p) return '';
  const s = String(p);
  return s.length > 80 ? `...${s.slice(-80)}` : s;
};

let _zoomOverlay = null,
  _zoomImg = null;
let _zoomScale = 1,
  _zoomTx = 0,
  _zoomTy = 0;
const ZOOM_MIN = 1,
  ZOOM_MAX = 12;
const applyZoom = () => {
  if (_zoomImg) _zoomImg.style.transform = `translate(${_zoomTx}px, ${_zoomTy}px) scale(${_zoomScale})`;
};
const resetZoom = () => {
  _zoomScale = 1;
  _zoomTx = 0;
  _zoomTy = 0;
  applyZoom();
};
const ensureFullscreen = () => {
  if (_zoomOverlay) return _zoomOverlay;
  const img = el('img', 'imgfs-img');
  const ov = el('div', 'imgfs', [img, el('div', 'imgfs-cap')]);
  const close = () => {
    ov.classList.remove('show');
    img.removeAttribute('src');
    resetZoom();
  };
  ov.addEventListener('click', (e) => {
    if (e.target === ov) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ov.classList.contains('show')) close();
  });

  ov.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const prev = _zoomScale;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
      const f = next / prev;
      if (f === 1) return;
      const rect = img.getBoundingClientRect();
      const cc = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const center0 = { x: cc.x - _zoomTx, y: cc.y - _zoomTy };
      const cmx = e.clientX - center0.x,
        cmy = e.clientY - center0.y;
      _zoomTx = cmx - (cmx - _zoomTx) * f;
      _zoomTy = cmy - (cmy - _zoomTy) * f;
      _zoomScale = next;
      if (_zoomScale <= ZOOM_MIN + 1e-3) {
        _zoomTx = 0;
        _zoomTy = 0;
        _zoomScale = ZOOM_MIN;
      }
      applyZoom();
    },
    { passive: false },
  );

  let dragging = false,
    sx = 0,
    sy = 0;
  img.addEventListener('pointerdown', (e) => {
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    img.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  img.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    _zoomTx += e.clientX - sx;
    _zoomTy += e.clientY - sy;
    sx = e.clientX;
    sy = e.clientY;
    applyZoom();
  });
  const endDrag = (e) => {
    if (dragging) {
      dragging = false;
      try {
        img.releasePointerCapture(e.pointerId);
      } catch (er) {}
    }
  };
  img.addEventListener('pointerup', endDrag);
  img.addEventListener('pointercancel', endDrag);
  img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    resetZoom();
  });

  document.body.appendChild(ov);
  _zoomOverlay = ov;
  _zoomImg = img;
  return ov;
};
const openFullscreen = (src, caption) => {
  if (!src) return;
  const ov = ensureFullscreen();
  _zoomImg.src = src;
  ov.querySelector('.imgfs-cap').textContent = caption || '';
  resetZoom();
  ov.classList.add('show');
};
const makeZoomable = (node, srcGetter, caption) => {
  node.classList.add('zoomable');
  node.title = 'クリックで全画面';
  node.addEventListener('click', () => {
    try {
      openFullscreen(srcGetter(), caption);
    } catch (e) {}
  });
};

const imageBody = (item) => {
  const label = shortPath(item.path);
  if (item.canvas) {
    makeZoomable(item.canvas, () => item.canvas.toDataURL('image/png'), label);
    return item.canvas;
  }
  if (item.imgUrl) {
    const img = el('img', { class: 'imgpreview', src: item.imgUrl, alt: item.type || 'image' });
    makeZoomable(img, () => img.src, label);
    return img;
  }
  return el('div', 'note', item.error || '画像化できませんでした');
};

const createImageCard = (item) =>
  el('div', 'imgcard', [
    el('div', 'imgcap', shortPath(item.path)),
    imageBody(item),
    el('div', 'imgmeta', item.width && item.height ? `${item.width}x${item.height} / offset ${item.offset}${item.type ? ' / ' + item.type : ''}` : 'no-rgba-preview'),
  ]);

export const imageZoom = { createImageCard };
