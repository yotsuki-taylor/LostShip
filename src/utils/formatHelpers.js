import { normalizeDeltaToNewFormat, getResourceLabels, RESOURCE_UNITS } from './resourceHelpers';

export const COMBAT_EXTRA_LABELS = { enemy_damage: 'Урон врагу' };

export function formatDeltaForLog(delta, extra = {}) {
  const combined = normalizeDeltaToNewFormat({ ...delta, ...extra });
  const labels = { ...getResourceLabels(), ...COMBAT_EXTRA_LABELS };
  const parts = [];
  Object.entries(combined).forEach(([key, val]) => {
    if (val === 0 || val === undefined) return;
    const label = labels[key] ?? key;
    const unit = RESOURCE_UNITS[key] ?? '';
    const sign = val > 0 ? '+' : '';
    parts.push(`${label}: ${sign}${val}${unit}`);
  });
  if (extra.enemy_damage > 0 && !combined.enemy_damage) parts.push(`${COMBAT_EXTRA_LABELS.enemy_damage}: ${extra.enemy_damage}`);
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}
