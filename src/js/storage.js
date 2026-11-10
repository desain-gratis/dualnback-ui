// localStorage persistence (settings + session history). Safe if storage is unavailable.

const KEY = 'dualnback:v1';

export const DEFAULT_SETTINGS = {
  n: 2,
  trials: 20,
  interval: 3000,
  showLetter: false,
  speak: true,
  auto: true,
  voice: 'auto',
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        history: Array.isArray(parsed.history) ? parsed.history : [],
      };
    }
  } catch (e) {
    /* fall through to defaults */
  }
  return { settings: { ...DEFAULT_SETTINGS }, history: [] };
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* ignore quota / privacy-mode errors */
  }
}
