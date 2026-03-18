import React from 'react';
import { getResourceLabels, RESOURCE_UNITS, RESOURCE_UI_KEYS } from '../utils/resourceHelpers';

const STATUS_ITEMS = [
  { key: 'demon', label: 'Демон' },
  { key: 'engine', label: 'Двигатель' },
];

const VALUE_COLORS = {
  сбежал: 'text-red-500',
  поврежден: 'text-red-500',
  ранен: 'text-red-500',
  захвачен: 'text-amber-400',
  подчинен: 'text-emerald-500',
  работает: 'text-emerald-500',
};

function getValueColor(value) {
  return VALUE_COLORS[value] || 'text-zinc-300';
}

export function InfoPanel({ playerVars, resources }) {
  const resourceLabels = getResourceLabels();
  const resourceKeys = RESOURCE_UI_KEYS.filter((k) => resources[k] !== undefined);

  return (
    <div className="terminal-panel p-3 font-mono mb-2">
      <table className="w-full text-left text-sm">
        <tbody>
          {STATUS_ITEMS.map(({ key, label }) => {
            const value = playerVars?.[key] || '—';
            const colorClass = value === '—' ? 'text-zinc-500' : getValueColor(value);
            return (
              <tr key={key} className="border-t border-zinc-700/50">
                <td className="py-0.5">{label}</td>
                <td className={`text-right font-medium ${colorClass}`}>{value}</td>
              </tr>
            );
          })}
          {resourceKeys.map((key) => {
            const val = resources[key];
            const isZero = val === 0 || val === '0';
            const valueColorClass = isZero ? 'text-red-500' : 'text-zinc-300';
            return (
              <tr key={key} className="border-t border-zinc-700/50">
                <td className="py-0.5">{resourceLabels[key] ?? key}</td>
                <td className={`text-right tabular-nums font-medium ${valueColorClass}`}>
                  {resources[key]}
                  {RESOURCE_UNITS[key] ?? ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
