import React from 'react';
import { SHIP_MODULES } from '../data/modules';

export function ShipModules({ moduleLevels, scrap, onUpgrade }) {
  return (
    <div className="terminal-panel p-3 font-mono">
      <div className="text-violet-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-1">
        [ МОДУЛИ КОРАБЛЯ ]
      </div>
      <ul className="space-y-2 text-sm">
        {SHIP_MODULES.map((mod) => {
          const level = moduleLevels[mod.id] ?? 0;
          const canUpgrade = level < mod.maxLevel && scrap >= mod.cost;
          return (
            <li key={mod.id} className="border border-zinc-700/50 rounded p-2">
              <div className="font-medium text-zinc-300">{mod.name}</div>
              <div className="text-xs text-zinc-500">{mod.description}</div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-zinc-500">
                  Ур. {level} / {mod.maxLevel}
                </span>
                <button
                  type="button"
                  disabled={!canUpgrade}
                  onClick={() => onUpgrade(mod.id)}
                  className="px-2 py-0.5 rounded border border-zinc-600 bg-zinc-800 text-xs hover:border-emerald-600/80 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Улучшить ({mod.cost} лом)
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
