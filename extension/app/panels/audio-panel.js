import { voiceOut } from './voice-out.js';
import { settings } from '../../core/settings.js';

export function createAudioPanel(deps) {
  const { homeBgm } = deps;

  function applyMasterVolume() {
    const vol = settings.get('masterVolume');
    voiceOut.setVolume(vol);
    if (homeBgm && homeBgm.applyVolume) homeBgm.applyVolume();
    try {
      window.dispatchEvent(new CustomEvent('tp:mastervol', { detail: vol }));
    } catch (e) {}
  }

  function bind() {
    settings.subscribe((n) => {
      if (n === 'masterVolume') applyMasterVolume();
    });
  }

  async function initFromStorage() {
    await settings.load();
    applyMasterVolume();
  }

  return { bind, initFromStorage, setMasterVolume: (v) => settings.set('masterVolume', v), onTabSwitched: voiceOut.stop };
}
