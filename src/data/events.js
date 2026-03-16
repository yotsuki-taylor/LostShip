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
      if (opt.consequences) {
        return { text: opt.text, delta: ensureAllResources(opt.consequences) };
      }
      if (opt.chance != null && opt.success != null && opt.failure != null) {
        return {
          text: opt.text,
          chance: opt.chance,
          success: ensureAllResources(opt.success),
          failure: ensureAllResources(opt.failure),
        };
      }
      return { text: opt.text, delta: {} };
    }),
  }));
}

/** Старые ключи в таблице/JSON — при нормализации маппятся в новые */
const OLD_KEYS = { crew: 'morale', stability: 'morale', scrap: 'supplies', energy: 'energy' };

function mapConsequencesToNew(obj) {
  const out = {};
  Object.entries(obj).forEach(([k, v]) => {
    const newKey = OLD_KEYS[k] ?? k;
    if (['hull', 'speed', 'energy', 'attack', 'supplies', 'morale'].includes(newKey)) {
      out[newKey] = (out[newKey] ?? 0) + (typeof v === 'number' ? v : 0);
    }
  });
  return out;
}

function ensureAllResources(obj) {
  const mapped = mapConsequencesToNew(obj);
  const defaults = { hull: 0, speed: 0, energy: 0, attack: 0, supplies: 0, morale: 0 };
  return { ...defaults, ...mapped };
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
