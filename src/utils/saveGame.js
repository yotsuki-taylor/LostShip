const SAVE_KEY = 'lost-ship-save';

const OLD_TO_NEW = { crew: 'morale', stability: 'morale', scrap: 'supplies', energy: 'energy' };
const NEW_KEYS = ['hull', 'speed', 'energy', 'attack', 'supplies', 'morale'];

/** Миграция старых сохранений (hull, crew, ...) в новый формат */
export function migrateResources(resources) {
  if (!resources || typeof resources !== 'object') return null;
  const hasOld = Object.keys(OLD_TO_NEW).some((k) => resources[k] !== undefined);
  if (!hasOld) return resources;
  const out = {};
  NEW_KEYS.forEach((k) => {
    out[k] = resources[k];
  });
  if (resources.hull !== undefined) out.hull = resources.hull;
  if (resources.energy !== undefined) out.energy = resources.energy;
  if (resources.scrap !== undefined) out.supplies = resources.scrap;
  if (resources.crew !== undefined || resources.stability !== undefined) {
    out.morale = Math.round(((resources.crew ?? 50) + (resources.stability ?? 50)) / 2);
  }
  out.speed = out.speed ?? 1;
  out.attack = out.attack ?? 1;
  return out;
}

export function saveGame(state) {
  try {
    const data = {
      resources: state.resources,
      turn: state.turn,
      eventLog: state.eventLog,
      stormProgress: state.stormProgress,
      playerVars: state.playerVars ?? {},
      crew: state.crew ?? [],
      mapState: state.mapState ?? null,
      nextDestinationEventId: state.nextDestinationEventId ?? 1,
      shownEventIds: state.shownEventIds ?? [],
      currentFight: state.currentFight ?? null,
      combatTurn: state.combatTurn ?? 0,
      enemyHp: state.enemyHp ?? 0,
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
