import eventsJson from './events.json';

/**
 * Нормализует события из JSON в формат приложения.
 * JSON: { id, title, text, options: [{ text, consequences? | chance, success, failure }] }
 * App:  { id, title, description, choices: [{ text, delta? | chance, success, failure }] }
 */
export function normalizeEvents(raw) {
  return raw.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.text,
    choices: e.options.map((opt) => {
      const base = { optReq: opt.req || opt.optReq || null };
      if (opt.consequences) {
        const { delta, setVariable, enemyDamage } = ensureAllResources(opt.consequences);
        return { ...base, text: opt.text, delta, setVariable, enemyDamage };
      }
      if (opt.chance != null && opt.success != null && opt.failure != null) {
        const topLevel = mapConsequencesToNew(opt);
        const succ = ensureAllResources(opt.success);
        const fail = ensureAllResources(opt.failure);
        const mergeSetVar = (sv) => (topLevel.setVariable && sv) ? { ...topLevel.setVariable, ...sv } : (topLevel.setVariable || sv);
        return {
          ...base,
          text: opt.text,
          chance: opt.chance,
          success: succ.delta,
          failure: fail.delta,
          successSetVariable: mergeSetVar(succ.setVariable),
          failureSetVariable: mergeSetVar(fail.setVariable),
          successEnemyDamage: succ.enemyDamage ?? topLevel.enemyDamage,
          failureEnemyDamage: fail.enemyDamage ?? topLevel.enemyDamage,
        };
      }
      return { ...base, text: opt.text, delta: {} };
    }),
  }));
}

/** Старые ключи в таблице/JSON — при нормализации маппятся в новые */
const OLD_KEYS = { crew: 'morale', stability: 'morale', scrap: 'supplies', energy: 'energy' };
const PLAYER_VAR_KEYS = ['ship', 'guest', 'dest', 'demon', 'engine', 'ship_mage', 'dest_lighthouse', 'dest_demon', 'fight'];

function mapConsequencesToNew(obj) {
  const delta = {};
  const setVariable = {};
  let enemyDamage;
  Object.entries(obj).forEach(([k, v]) => {
    const kLower = String(k).toLowerCase().trim();
    const newKey = OLD_KEYS[kLower] ?? kLower;
    const numVal = typeof v === 'number' ? v : (typeof v === 'string' ? parseInt(v, 10) : null);
    const num = numVal !== null && !Number.isNaN(numVal) ? numVal : null;
    if (['hull', 'speed', 'energy', 'attack', 'supplies', 'morale'].includes(newKey) && typeof v === 'number') {
      delta[newKey] = (delta[newKey] ?? 0) + v;
    } else if (PLAYER_VAR_KEYS.includes(kLower) && (typeof v === 'string' || typeof v === 'number')) {
      setVariable[kLower] = typeof v === 'string' ? v : String(v);
    } else if (kLower === 'enemy_hp' && num !== null && num < 0) enemyDamage = Math.abs(num);
    else if (kLower === 'enemy_damage' && num !== null && num > 0) enemyDamage = num;
  });
  const defaults = { hull: 0, speed: 0, energy: 0, attack: 0, supplies: 0, morale: 0 };
  return { delta: { ...defaults, ...delta }, setVariable: Object.keys(setVariable).length ? setVariable : null, enemyDamage };
}

function ensureAllResources(obj) {
  return mapConsequencesToNew(obj);
}

export const events = normalizeEvents(eventsJson);

/** Минимальные/максимальные значения ресурсов */
export const RESOURCE_LIMITS = {
  hull: { min: 0, max: 100 },
  speed: { min: 0, max: 10 },
  energy: { min: 0, max: 100 },
  attack: { min: 0, max: 10 },
  supplies: { min: 0, max: 999 },
  morale: { min: 0, max: 100 },
};
