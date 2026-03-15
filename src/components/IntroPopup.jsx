import React from 'react';

/**
 * Попап интро — стиль как у событий, при выборе просто следующий слайд.
 */
export function IntroPopup({ slide, onNext }) {
  if (!slide) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="intro-title"
    >
      <div className="terminal-panel p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl border-amber-600/50">
        <div className="text-amber-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-2">
          [ ПРОЛОГ ]
        </div>
        <h2 id="intro-title" className="text-xl font-bold text-amber-400 mb-3">
          {slide.title}
        </h2>
        <p className="text-zinc-300 mb-6 leading-relaxed">{slide.text}</p>
        <div className="space-y-3">
          {slide.choices.map((choice, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onNext()}
              className="block w-full text-left px-4 py-3 rounded border-2 border-zinc-600 bg-zinc-800/90 font-mono hover:border-amber-500 hover:bg-zinc-700/90 transition-colors"
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
