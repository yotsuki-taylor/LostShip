import { RESOURCE_LIMITS } from '../data/events';

const RESOURCE_LABELS = {
  hull: 'Прочность',
  speed: 'Скорость',
  energy: 'Энергия',
  attack: 'Атака',
  supplies: 'Припасы',
  morale: 'Мораль',
};

/** Старые ключи из таблицы/JSON — маппятся в новые при применении */
const OLD_TO_NEW = {
  crew: 'morale',
  stability: 'morale',
  scrap: 'supplies',
  energy: 'energy',
};

export const RESOURCE_KEYS = ['hull', 'speed', 'energy', 'attack', 'supplies', 'morale'];

/** Ключи для проверки дельт из событий (включая старый формат таблицы) */
export const DELTA_KEYS = [...RESOURCE_KEYS, ...Object.keys(OLD_TO_NEW)];

export const STATUS_VAR_KEYS = ['demon', 'engine', 'ship_mage'];

export const RESOURCE_UNITS = {
  hull: '%',
  speed: '',
  energy: '%',
  attack: 'd6',
  supplies: '',
  morale: '%',
};

/**
 * Возвращает подписи ресурсов.
 */
export function getResourceLabels() {
  return { ...RESOURCE_LABELS };
}

/**
 * Возвращает лимиты ресурсов.
 */
export function getResourceLimits() {
  const limits = {};
  Object.keys(RESOURCE_LIMITS).forEach((key) => {
    limits[key] = { ...RESOURCE_LIMITS[key] };
  });
  return limits;
}

/**
 * Ограничивает значение ресурса в допустимых границах.
 */
export function clampResource(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Применяет множитель сложности к отрицательным значениям дельты.
 * @param deltas - объект с изменениями ресурсов
 * @param multiplier - множитель (например 1.2 для +20% урона)
 */
export function applyDifficultyToDeltas(deltas, multiplier) {
  const result = { ...deltas };
  Object.keys(result).forEach((key) => {
    const val = result[key];
    if (typeof val === 'number' && val < 0) {
      result[key] = Math.round(val * multiplier);
    }
  });
  return result;
}

/**
 * Преобразует дельты из старого формата (hull, crew, stability, scrap) в новый.
 * crew и stability суммируются в morale.
 */
export function normalizeDeltaToNewFormat(deltas) {
  const result = {};
  Object.entries(deltas).forEach(([key, val]) => {
    if (typeof val !== 'number') return;
    const newKey = OLD_TO_NEW[key] ?? key;
    if (RESOURCE_KEYS.includes(newKey)) {
      result[newKey] = (result[newKey] ?? 0) + val;
    }
  });
  return result;
}

/**
 * Применяет дельты к ресурсам и возвращает новый объект ресурсов (с учётом лимитов).
 * Поддерживает старый формат (hull, crew и т.д.) — автоматически маппит в новый.
 */
export function applyDeltas(resources, deltas, limits) {
  const normalized = normalizeDeltaToNewFormat(deltas);
  const next = { ...resources };
  Object.keys(normalized).forEach((key) => {
    if (next[key] !== undefined && limits[key]) {
      next[key] = clampResource(
        next[key] + (normalized[key] ?? 0),
        limits[key].min,
        limits[key].max
      );
    }
  });
  return next;
}
