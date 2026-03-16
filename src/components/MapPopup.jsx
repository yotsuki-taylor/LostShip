import React from 'react';
import { MapView } from './MapView';

/**
 * Модальное окно карты в стиле FTL.
 * @param {object} mapState - состояние карты (nodes, edges, currentNodeId, visitedIds)
 * @param {function} onNodeClick - (nodeId) => void — при клике на доступный узел
 * @param {function} onClose - закрытие по клику на фон
 */
export function MapPopup({ mapState, onNodeClick, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer"
      role="dialog"
      aria-modal="true"
      aria-label="Карта"
      onClick={onClose}
    >
      <div
        className="terminal-panel p-6 max-w-5xl w-full shadow-2xl border-amber-600/50 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-amber-500/90 text-sm font-semibold mb-4 border-b border-zinc-600 pb-2">
          [ КАРТА ЗВЁЗДНОГО ПУТИ ]
        </div>
        <MapView mapState={mapState} onNodeClick={onNodeClick} />
        <div className="mt-4 pt-3 border-t border-zinc-600 flex flex-wrap gap-6 text-xs text-zinc-400">
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 rounded-full bg-emerald-500/50 border-2 border-emerald-500" />
            Исследовано
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-5 h-5 rounded-full bg-amber-500 border-2 border-amber-600" />
            Актуальная локация
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-4 h-4 rounded-full bg-amber-500/40 border-2 border-amber-500 border-dashed" />
            Доступно для прыжка
          </span>
        </div>
      </div>
    </div>
  );
}
