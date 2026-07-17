'use strict';
(function () {
  function createController(deps) {
    const { $, storage } = deps;

    function clamp01(v) {
      return Math.max(0, Math.min(1, Number(v) || 0));
    }

    function setMasterVolume(v) {
      const vol = clamp01(v);
      const a = $('audio');
      const slider = $('masterVolume');
      const label = $('masterVolumeVal');
      if (!a || !slider || !label) return;
      a.volume = vol;
      const percent = Math.round(vol * 100);
      slider.value = String(percent);
      label.textContent = `${percent}%`;
    }

    function setAudioUiVisible(show) {
      const on = !!show;
      const a = $('audio');
      const ui = $('audioUi');
      if (!a || !ui) return;
      a.controls = on;
      a.style.display = on ? '' : 'none';
      ui.checked = on;
    }

    function bind() {
      const volume = $('masterVolume');
      const audioUi = $('audioUi');
      if (volume) {
        volume.addEventListener('input', async (e) => {
          const vol = clamp01((Number(e.target.value) || 0) / 100);
          setMasterVolume(vol);
          if (storage && storage.set) await storage.set({ masterVolume: vol });
        });
      }
      if (audioUi) {
        audioUi.addEventListener('change', async (e) => {
          const on = !!e.target.checked;
          setAudioUiVisible(on);
          if (storage && storage.set) await storage.set({ showAudioControls: on });
        });
      }
    }

    async function initFromStorage() {
      let masterVolume = 0.5;
      let showAudioControls = false;
      try {
        if (storage && storage.get) {
          const o = await storage.get(['masterVolume', 'showAudioControls']);
          masterVolume = o.masterVolume == null ? 0.5 : o.masterVolume;
          showAudioControls = !!o.showAudioControls;
        }
      } catch (e) {}
      setMasterVolume(masterVolume);
      setAudioUiVisible(showAudioControls);
    }

    return { bind, initFromStorage, setMasterVolume, setAudioUiVisible };
  }

  globalThis.TP_PLAYER_AUDIO = { createController };
})();
