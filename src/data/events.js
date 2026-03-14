import eventsJson from './events.json';

/**
 * Нормализует события из JSON в формат приложения.
 * JSON: { id, title, text, options: [{ text, consequences? | chance, success, failure }] }
 * App:  { id, title, description, choices: [{ text, delta? | chance, success, failure }] }
 */
function normalizeEvents(raw) {
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

function ensureAllResources(obj) {
  const defaults = { hull: 0, energy: 0, scrap: 0, crew: 0, stability: 0 };
  return { ...defaults, ...obj };
}

export const events = normalizeEvents(eventsJson);

/** Базовая регенерация энергии за ход */
export const ENERGY_REGEN_PER_TURN = 8;

/** Минимальные/максимальные значения ресурсов */
export const RESOURCE_LIMITS = {
  hull: { min: 0, max: 100 },
  energy: { min: 0, max: 100 },
  scrap: { min: 0, max: 999 },
  crew: { min: 0, max: 50 },
  stability: { min: 0, max: 100 },
};
