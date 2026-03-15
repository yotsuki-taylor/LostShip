import React from 'react';

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

export function StatusPanel({ playerVars }) {
  return (
    <div className="terminal-panel p-3 font-mono mb-4">
      <div className="text-amber-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-1">
        [ СТАТУСЫ ]
      </div>
      <table className="w-full text-left text-sm">
        <tbody>
          {STATUS_ITEMS.map(({ key, label }) => {
            const value = playerVars?.[key] || '—';
            const colorClass = value === '—' ? 'text-zinc-500' : getValueColor(value);
            return (
              <tr key={key} className="border-t border-zinc-700/50">
                <td className="py-0.5">{label}</td>
                <td className={`text-right font-medium ${colorClass}`}>
                  {value}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
