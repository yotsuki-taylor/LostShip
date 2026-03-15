const SAVE_KEY = 'lost-ship-save';

export function saveGame(state) {
  try {
    const data = {
      resources: state.resources,
      moduleLevels: state.moduleLevels,
      turn: state.turn,
      eventLog: state.eventLog,
      stormProgress: state.stormProgress,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function hasSave() {
  return localStorage.getItem(SAVE_KEY) != null;
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}
