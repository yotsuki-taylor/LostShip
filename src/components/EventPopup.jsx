import React from 'react';
import { matchesEventReq } from '../services/sheetLoader';

/**
 * Модальное окно для событий — перекрывает экран, невозможно пропустить.
 * Фильтрует варианты по optReq (если задан).
 */
export function EventPopup({ event, onChoice, disabled, playerVars = {}, resources = {} }) {
  if (!event) return null;

  const visibleChoices = (event.choices || [])
    .map((c, i) => ({ ...c, _idx: i }))
    .filter((c) => !c.optReq || matchesEventReq(c.optReq, playerVars, resources));

  const choicesToShow = visibleChoices.length > 0 ? visibleChoices : [{ text: 'Продолжить', _idx: -1, delta: {} }];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-title"
    >
      <div className="terminal-panel p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border-amber-600/50">
        <div className="text-amber-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-2">
          [ СОБЫТИЕ ]
        </div>
        <h2 id="event-title" className="text-xl font-bold text-amber-400 mb-3">
          {event.title}
        </h2>
        <p className="text-zinc-300 mb-6 leading-relaxed">{event.description}</p>
        <div className="space-y-3">
          {choicesToShow.map((choice, idx) => (
            <button
              key={idx}
              type="button"
              disabled={disabled}
              onClick={() => onChoice(choice)}
              className="block w-full text-left px-4 py-3 rounded border-2 border-zinc-600 bg-zinc-800/90 font-mono hover:border-amber-500 hover:bg-zinc-700/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <span className="text-zinc-500 select-none">[{idx + 1}] </span>
              {choice.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
