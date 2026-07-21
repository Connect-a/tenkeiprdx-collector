'use strict';
// 画像の全画面ズーム/パン オーバーレイと、ギャラリー用の画像カード生成。
(function () {
  const shortPath = (p) => {
    if (!p) return '';
    const s = String(p);
    return s.length > 80 ? `...${s.slice(-80)}` : s;
  };

  let _zoomOverlay = null, _zoomImg = null;
  let _zoomScale = 1, _zoomTx = 0, _zoomTy = 0;
  const ZOOM_MIN = 1, ZOOM_MAX = 12;
  const applyZoom = () => { if (_zoomImg) _zoomImg.style.transform = `translate(${_zoomTx}px, ${_zoomTy}px) scale(${_zoomScale})`; };
  const resetZoom = () => { _zoomScale = 1; _zoomTx = 0; _zoomTy = 0; applyZoom(); };
  const ensureFullscreen = () => {
    if (_zoomOverlay) return _zoomOverlay;
    const ov = document.createElement('div');
    ov.className = 'imgfs';
    const img = document.createElement('img');
    img.className = 'imgfs-img';
    const cap = document.createElement('div');
    cap.className = 'imgfs-cap';
    ov.appendChild(img);
    ov.appendChild(cap);
    const close = () => { ov.classList.remove('show'); img.removeAttribute('src'); resetZoom(); };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('show')) close(); });

    ov.addEventListener('wheel', (e) => {
      e.preventDefault();
      const prev = _zoomScale;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, prev * factor));
      const f = next / prev;
      if (f === 1) return;
      const rect = img.getBoundingClientRect();
      const cc = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const center0 = { x: cc.x - _zoomTx, y: cc.y - _zoomTy };
      const cmx = e.clientX - center0.x, cmy = e.clientY - center0.y;
      _zoomTx = cmx - (cmx - _zoomTx) * f;
      _zoomTy = cmy - (cmy - _zoomTy) * f;
      _zoomScale = next;
      if (_zoomScale <= ZOOM_MIN + 1e-3) { _zoomTx = 0; _zoomTy = 0; _zoomScale = ZOOM_MIN; }
      applyZoom();
    }, { passive: false });

    let dragging = false, sx = 0, sy = 0;
    img.addEventListener('pointerdown', (e) => { dragging = true; sx = e.clientX; sy = e.clientY; img.setPointerCapture(e.pointerId); e.preventDefault(); });
    img.addEventListener('pointermove', (e) => { if (!dragging) return; _zoomTx += e.clientX - sx; _zoomTy += e.clientY - sy; sx = e.clientX; sy = e.clientY; applyZoom(); });
    const endDrag = (e) => { if (dragging) { dragging = false; try { img.releasePointerCapture(e.pointerId); } catch (er) {} } };
    img.addEventListener('pointerup', endDrag);
    img.addEventListener('pointercancel', endDrag);
    img.addEventListener('dblclick', (e) => { e.preventDefault(); resetZoom(); });

    document.body.appendChild(ov);
    _zoomOverlay = ov; _zoomImg = img;
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
    node.addEventListener('click', () => { try { openFullscreen(srcGetter(), caption); } catch (e) { console.debug('[tp] openFullscreen failed', e); } });
  };

  const createImageCard = (item, opt) => {
    const box = document.createElement('div');
    box.className = 'imgcard';

    const cap = document.createElement('div');
    cap.className = 'imgcap';
    cap.textContent = shortPath(item.path);
    box.appendChild(cap);

    if (item.canvas) {
      makeZoomable(item.canvas, () => item.canvas.toDataURL('image/png'), shortPath(item.path));
      box.appendChild(item.canvas);
    }
    else if (item.imgUrl) {
      const img = document.createElement('img');
      img.src = item.imgUrl;
      img.alt = item.type || 'image';
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
      img.style.border = '1px solid #3a3650';
      img.style.borderRadius = '6px';
      makeZoomable(img, () => img.src, shortPath(item.path));
      box.appendChild(img);
    }
    else {
      const ph = document.createElement('div');
      ph.className = 'note';
      ph.textContent = item.error || '画像化できませんでした';
      box.appendChild(ph);
    }

    const meta = document.createElement('div');
    meta.className = 'imgmeta';
    if (item.width && item.height) meta.textContent = `${item.width}x${item.height} / offset ${item.offset}${item.type ? ' / ' + item.type : ''}`;
    else meta.textContent = 'no-rgba-preview';
    box.appendChild(meta);
    return box;
  };

  globalThis.TP_IMGZOOM = { createImageCard, openFullscreen, makeZoomable };
})();
