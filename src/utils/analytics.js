const SESSIONS_KEY = 'lost-ship-sessions';
const MAX_SESSIONS = 500;

export function recordSession({ outcome, turns, resources, gameCrew, lastFightName, playerVars }) {
  const session = {
    id: Date.now(),
    date: new Date().toISOString(),
    outcome, // 'win' | 'lose' | 'quit'
    turns,
    hull: resources?.hull ?? 0,
    energy: resources?.energy ?? 0,
    supplies: resources?.supplies ?? 0,
    morale: resources?.morale ?? 0,
    crewSurvived: (gameCrew ?? []).filter((m) => (m.hp ?? 0) > 0).length,
    crewTotal: (gameCrew ?? []).length,
    lastFight: lastFightName ?? null,
    dest: playerVars?.dest ?? null,
    destLighthouse: playerVars?.dest_lighthouse ?? 'undone',
    destDemon: playerVars?.dest_demon ?? 'undone',
  };

  try {
    const existing = getSessions();
    const updated = [...existing, session].slice(-MAX_SESSIONS);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(updated));
  } catch {}

  return session;
}

export function getSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
