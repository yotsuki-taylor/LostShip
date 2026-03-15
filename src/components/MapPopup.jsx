import React from 'react';

export function MapPopup({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Карта"
    >
      <div className="terminal-panel p-6 max-w-lg w-full shadow-2xl border-amber-600/50">
        <div className="text-amber-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-2 flex justify-between items-center">
          <span>[ КАРТА ]</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-amber-400 text-xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <p className="text-zinc-500 py-8 text-center">Карта в разработке</p>
        <button
          type="button"
          onClick={onClose}
          className="w-full py-2 rounded border border-zinc-600 hover:border-amber-500 text-zinc-300 hover:text-amber-400 transition-colors"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
