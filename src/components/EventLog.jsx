import React from 'react';

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
          entries.map((line, i) => (
            <div key={i} className="leading-relaxed">
              <span className="text-zinc-600 select-none">&gt; </span>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
