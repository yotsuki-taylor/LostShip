import React from 'react';

const MAX_HP = 20;

export function CrewPopup({ crew, onClose }) {
  const displayCrew = [...crew].slice(0, 6);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Команда"
    >
      <div className="terminal-panel p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border-amber-600/50">
        <div className="text-amber-500/90 text-sm font-semibold mb-4 border-b border-zinc-600 pb-2 flex justify-between items-center">
          <span>[ КОМАНДА ]</span>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-amber-400 text-xl leading-none"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {displayCrew.map((c) => {
            const idSlug = (c.id ?? 'unknown').toString().toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '_').replace(/_+/g, '_') || 'unknown';
            const avatarSrc = `/LostShip/images/${idSlug}.png`;
            return (
            <div
              key={c.id}
              className="flex flex-col items-center p-3 rounded border border-zinc-600 bg-zinc-800/50"
            >
              <div className="relative rounded overflow-hidden bg-zinc-700 flex-shrink-0 mb-2 min-w-[6rem] min-h-[3.5rem] flex justify-center">
                <img
                  src={avatarSrc}
                  alt=""
                  className="block w-auto h-auto max-w-[200px] max-h-[120px] object-contain"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    const fb = e.target.parentElement?.querySelector('.avatar-fallback');
                    if (fb) fb.classList.remove('hidden');
                  }}
                />
                <div className="avatar-fallback absolute inset-0 hidden flex items-center justify-center text-zinc-500 text-2xl bg-zinc-700">
                  ?
                </div>
              </div>
              <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full transition-all ${
                    c.hp <= 0 ? 'bg-red-600' : c.hp < MAX_HP ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${Math.max(0, (c.hp / MAX_HP) * 100)}%` }}
                />
              </div>
              <p className="text-sm font-medium text-zinc-200 truncate w-full text-center">{c.name}</p>
              <p className="text-xs text-zinc-500 truncate w-full text-center">{c.role}</p>
              <p
                className={`text-xs mt-0.5 ${
                  c.status === 'убит' ? 'text-red-500' : c.status === 'ранен' ? 'text-amber-500' : 'text-emerald-500'
                }`}
              >
                {c.status}
              </p>
            </div>
          );
          })}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full py-2 rounded border border-zinc-600 hover:border-amber-500 text-zinc-300 hover:text-amber-400 transition-colors"
        >
          Закрыть
        </button>
      </div>
    </div>
  );
}
