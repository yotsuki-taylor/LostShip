import React from 'react';
import { getResourceLabels, RESOURCE_UNITS, RESOURCE_KEYS } from '../utils/resourceHelpers';

export function ResourcePanel({ resources }) {
  const resourceLabels = getResourceLabels();
  const keys = RESOURCE_KEYS.filter((k) => resources[k] !== undefined);
  return (
    <div className="terminal-panel p-3 font-mono">
      <div className="text-emerald-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-1">
        [ РЕСУРСЫ ]
      </div>
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-zinc-500">
            <th className="font-normal">Параметр</th>
            <th className="font-normal text-right">Значение</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-t border-zinc-700/50">
              <td className="py-0.5">{resourceLabels[key] ?? key}</td>
              <td className="text-right tabular-nums">
                {resources[key]}
                {RESOURCE_UNITS[key] ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
