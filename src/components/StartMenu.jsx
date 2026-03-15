import React from 'react';

/**
 * Стартовое меню: "Начать игру" и "Продолжить" (если есть сохранение).
 */
export function StartMenu({ onNewGame, onContinue, hasSave }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold text-amber-500/90 tracking-wider mb-2">
        LOST SHIP
      </h1>
      <p className="text-zinc-500 text-sm mb-12 text-center max-w-md">Там, где гаснет свет миров, начинается твой путь сквозь планарный хаос</p>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <button
          type="button"
          onClick={onNewGame}
          className="px-8 py-3 rounded-lg border-2 border-amber-600 bg-amber-900/30 font-bold text-amber-400 hover:bg-amber-800/40 hover:border-amber-500 transition-colors"
        >
          НАЧАТЬ ИГРУ
        </button>

        {hasSave && (
          <button
            type="button"
            onClick={onContinue}
            className="px-8 py-3 rounded-lg border-2 border-zinc-600 bg-zinc-800/50 font-semibold text-zinc-300 hover:bg-zinc-700/50 hover:border-zinc-500 transition-colors"
          >
            ПРОДОЛЖИТЬ
          </button>
        )}
      </div>
    </div>
  );
}
