import React from 'react';

const RESOURCE_LABELS = {
  hull: 'Корпус',
  energy: 'Энергия',
  scrap: 'Лом',
  crew: 'Экипаж',
  stability: 'Стабильность',
};

const RESOURCE_UNITS = {
  hull: '%',
  energy: '%',
  scrap: '',
  crew: '',
  stability: '%',
};

export function ResourcePanel({ resources, limits }) {
  return (
    <div className="terminal-panel p-3 font-mono">
      <div className="text-emerald-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-1">
        [ РЕСУРСЫ ]
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-zinc-500">
            <th className="font-normal">Параметр</th>
            <th className="font-normal text-right">Текущ.</th>
            <th className="font-normal text-right">Макс.</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(resources).map(([key, value]) => (
            <tr key={key} className="border-t border-zinc-700/50">
              <td className="py-0.5">{RESOURCE_LABELS[key] ?? key}</td>
              <td className="text-right tabular-nums">
                {value}
                {RESOURCE_UNITS[key] ?? ''}
              </td>
              <td className="text-right tabular-nums text-zinc-500">
                {limits[key]?.max ?? '—'}
                {RESOURCE_UNITS[key] ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
