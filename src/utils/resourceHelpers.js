import { RESOURCE_LIMITS } from '../data/events';
import { SHIP_MODULES } from '../data/modules';

/**
 * Вычисляет текущие лимиты ресурсов с учётом уровней модулей.
 */
export function getResourceLimits(moduleLevels) {
  const limits = {};
  Object.keys(RESOURCE_LIMITS).forEach((key) => {
    limits[key] = { ...RESOURCE_LIMITS[key] };
  });
  SHIP_MODULES.forEach((mod) => {
    const level = moduleLevels[mod.id] ?? 0;
    if (level > 0 && limits[mod.resource]) {
      limits[mod.resource].max += mod.bonus * level;
    }
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
 * Применяет дельты к ресурсам и возвращает новый объект ресурсов (с учётом лимитов).
 */
export function applyDeltas(resources, deltas, limits) {
  const next = { ...resources };
  Object.keys(deltas).forEach((key) => {
    if (next[key] !== undefined && limits[key]) {
      next[key] = clampResource(
        next[key] + (deltas[key] ?? 0),
        limits[key].min,
        limits[key].max
      );
    }
  });
  return next;
}
