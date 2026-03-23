import React from 'react';

const CYAN = 'text-cyan-500/90 font-semibold';

/** Подсветка фразы «Новое направление» в куске строки */
function renderNewDirectionPhraseParts(segment, baseClass, keyPrefix) {
  const parts = segment.split(/(новое направление)/gi);
  return parts.map((part, idx) =>
    /^новое направление$/i.test(part) ? (
      <span key={`${keyPrefix}-${idx}`} className={CYAN}>
        {part}
      </span>
    ) : (
      <span key={`${keyPrefix}-${idx}`} className={baseClass}>
        {part}
      </span>
    )
  );
}

/**
 * Для строк с «Новое направление»: заголовок и выбранный вариант после → "…" — голубые, как «Курс на».
 */
function renderWithNewDirectionHighlight(text, baseClass) {
  if (!text || !/новое направление/i.test(text)) {
    return <span className={baseClass}>{text}</span>;
  }

  const choiceMatch = text.match(/^(.*?)( → ")([^"]+)(")(.*)$/);
  if (!choiceMatch) {
    return <>{renderNewDirectionPhraseParts(text, baseClass, 'nd')}</>;
  }

  const [, before, arrowQuote, choice, closeQuote, after] = choiceMatch;
  return (
    <>
      {renderNewDirectionPhraseParts(before, baseClass, 'nd-b')}
      <span className={baseClass}>{arrowQuote}</span>
      <span className={CYAN}>{choice}</span>
      <span className={baseClass}>
        {closeQuote}
        {after}
      </span>
    </>
  );
}

export function EventLog({ entries }) {
  return (
    <div className="terminal-panel p-3 font-mono flex flex-col h-full min-h-[200px] mb-2">
      <div className="text-amber-500/90 text-sm font-semibold mb-2 border-b border-zinc-600 pb-1">
        [ ЛОГ СОБЫТИЙ ]
      </div>
      <div className="flex-1 overflow-y-auto text-xs text-zinc-400 space-y-1">
        {entries.length === 0 ? (
          <div className="text-zinc-600 italic">— Лог пуст. Сделайте выбор, чтобы начать. —</div>
        ) : (
          entries.map((line, i) => {
            const text = typeof line === 'object' ? line.text : line;
            const colorClass =
              text === 'Демон захвачен.' ? 'text-amber-400' :
              text === 'Демон подчинён.' ? 'text-emerald-500' :
              text === 'Двигатель: работает.' ? 'text-emerald-500' :
              text === 'Враг повержен! Победа!' ? 'text-emerald-500' :
              text === 'Мораль на нуле! Прочность корабля падает.' ? 'text-red-500' :
              text === 'Экипаж голодает! Мораль и прочность корабля падают.' ? 'text-red-500' :
              text === 'Штрафы за критические ресурсы применены.' ? 'text-red-500' :
              null;
            const baseClass = colorClass ?? 'text-zinc-400';
            return (
              <div key={i} className="leading-relaxed">
                <span className="text-zinc-600 select-none">&gt; </span>
                {renderWithNewDirectionHighlight(text, baseClass)}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
