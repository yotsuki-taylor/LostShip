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
          [ КАРТА ПЛАНАРНОГО ПУТИ ]
        </div>
        <MapView mapState={mapState} onNodeClick={onNodeClick} />
        <div className="mt-4 pt-3 border-t border-zinc-600 flex flex-wrap gap-6 text-xs text-zinc-400">
          <span className="flex items-center gap-2">
            <span
              className="inline-block w-4 h-4 rounded-full border-2"
              style={{ backgroundColor: 'rgba(34, 197, 94, 0.5)', borderColor: 'rgb(34, 197, 94)' }}
            />
            Исследовано
          </span>
          <span className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 52 52" className="shrink-0">
              <circle cx="26" cy="26" r="24" fill="rgb(251, 191, 36)" stroke="rgb(245, 158, 11)" strokeWidth="2" />
              <circle cx="26" cy="26" r="16.3" fill="rgb(39, 39, 42)" />
            </svg>
            Актуальная локация
          </span>
          <span className="flex items-center gap-2">
            <svg width="16" height="16" className="shrink-0">
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="rgba(251, 191, 36, 0.4)"
                stroke="rgb(251, 191, 36)"
                strokeWidth="2"
                strokeDasharray="4 2"
              />
            </svg>
            Доступно для прыжка
          </span>
        </div>
      </div>
    </div>
  );
}
