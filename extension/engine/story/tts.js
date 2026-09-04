const MIN_REAL_MS = 350;

export function createTts({ getCurrentText, masterVol }) {
  const synthObj = () => window.speechSynthesis || null;
  let utter = null;
  let state = 'idle';
  let gen = -1;
  let jaVoice = null;

  const pickJaVoice = (s) => {
    try {
      return (s.getVoices() || []).find((v) => /ja(-|_)?JP/i.test(v.lang) || /japanese/i.test(v.name)) || null;
    } catch (e) {
      return null;
    }
  };

  function cancel() {
    const s = synthObj();
    if (s) {
      try {
        s.cancel();
      } catch (e) {}
    }
    utter = null;
    state = 'idle';
    gen = -1;
  }

  function speak(atGen, audible) {
    const s = synthObj();
    if (!s) {
      gen = atGen;
      state = 'unavailable';
      return;
    }
    if (gen === atGen && utter) return;
    const text = getCurrentText() || '';
    gen = atGen;
    try {
      s.cancel();
    } catch (e) {}
    if (!text) {
      utter = null;
      state = 'done';
      return;
    }
    if (!jaVoice) jaVoice = pickJaVoice(s);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (jaVoice) u.voice = jaVoice;
    u.volume = audible ? Math.min(1, masterVol() * 1.8) : 0;
    utter = u;
    state = 'speaking';
    const startedAt = Date.now();
    u.onend = () => {
      if (utter === u) state = Date.now() - startedAt < MIN_REAL_MS ? 'unavailable' : 'done';
    };
    u.onerror = () => {
      if (utter === u) state = 'unavailable';
    };
    try {
      s.speak(u);
    } catch (e) {
      state = 'unavailable';
    }
  }

  return {
    speak,
    cancel,
    available: () => !!synthObj(),
    get state() {
      return state;
    },
  };
}
