import React from 'react';

export function MapPopup({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer"
      role="dialog"
      aria-modal="true"
      aria-label="Карта"
      onClick={onClose}
    >
      <div
        className="terminal-panel p-6 max-w-lg w-full shadow-2xl border-amber-600/50 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-amber-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-2">
          [ КАРТА ]
        </div>
        <p className="text-zinc-500 py-8 text-center">Карта в разработке</p>
      </div>
    </div>
  );
}
