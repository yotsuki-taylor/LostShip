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
        <p className="text-zinc-500 text-xs mb-3">
          Выберите узел для прыжка (подсвечены жёлтым)
        </p>
        <MapView mapState={mapState} onNodeClick={onNodeClick} />
      </div>
    </div>
  );
}
