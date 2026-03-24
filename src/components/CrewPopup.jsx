import React, { useState, useEffect } from 'react';
import { XP_PER_LEVEL } from '../utils/crewXp';

const MAX_HP = 20;

export function CrewPopup({
  crew,
  onClose,
  onLevelChoice = () => {},
  onManualLevelUp = () => {},
  skillModalMember = null,
  onSkillModalClose = () => {},
}) {
  const displayCrew = [...crew].slice(0, 6);
  const [modalMember, setModalMember] = useState(null);

  useEffect(() => {
    if (skillModalMember) {
      setModalMember(skillModalMember);
    }
  }, [skillModalMember]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm cursor-pointer"
      role="dialog"
      aria-modal="true"
      aria-label="Команда"
      onClick={onClose}
    >
      {modalMember && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70"
          role="dialog"
          aria-modal="true"
          aria-label="Выбор улучшения"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="terminal-panel p-6 max-w-lg w-full border-amber-500/60 shadow-2xl">
            <p className="text-amber-400 font-semibold mb-2">{modalMember.name}</p>
            <p className="text-zinc-400 text-sm mb-4">Новый уровень — выберите улучшение:</p>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                className="text-left py-3 px-4 rounded border border-zinc-600 bg-zinc-800/80 hover:border-amber-500 hover:text-amber-200 text-sm text-zinc-200 transition-colors"
                onClick={() => {
                  onLevelChoice?.(modalMember.id, 1);
                  setModalMember(null);
                  onSkillModalClose();
                }}
              >
                {modalMember.pendingLevelChoice?.opt1 ?? '—'}
              </button>
              <button
                type="button"
                className="text-left py-3 px-4 rounded border border-zinc-600 bg-zinc-800/80 hover:border-amber-500 hover:text-amber-200 text-sm text-zinc-200 transition-colors"
                onClick={() => {
                  onLevelChoice?.(modalMember.id, 2);
                  setModalMember(null);
                  onSkillModalClose();
                }}
              >
                {modalMember.pendingLevelChoice?.opt2 ?? '—'}
              </button>
            </div>
            <button
              type="button"
              className="mt-4 text-xs text-zinc-500 hover:text-zinc-300"
              onClick={() => {
                setModalMember(null);
                onSkillModalClose();
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      <div
        className="terminal-panel p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border-amber-600/50 cursor-default"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-amber-500/90 text-sm font-semibold mb-4 border-b border-zinc-600 pb-2">
          [ КОМАНДА ]
        </div>
        <div className="grid grid-cols-3 gap-4">
          {displayCrew.map((c) => {
            const idSlug = (c.id ?? 'unknown').toString().toLowerCase().replace(/[^a-z0-9а-яё_-]/gi, '_').replace(/_+/g, '_') || 'unknown';
            const avatarSrc = `/LostShip/images/${idSlug}.png`;
            const xp = Math.max(0, c.xp ?? 0);
            const xpFill = Math.min(xp, XP_PER_LEVEL) / XP_PER_LEVEL;
            const pendingSkill = c.pendingLevelChoice || (c.pendingLevelQueue && c.pendingLevelQueue[0]);
            const hasSkillPick = pendingSkill && (pendingSkill.opt1 || pendingSkill.opt2);
            const canManualLevel = (c.hp ?? 0) > 0 && xp >= XP_PER_LEVEL;
            const showLevelBtn = hasSkillPick || canManualLevel;

            const handleLevelClick = (e) => {
              e.stopPropagation();
              if (hasSkillPick) {
                setModalMember({ ...c, pendingLevelChoice: pendingSkill });
              } else if (canManualLevel) {
                onManualLevelUp(c.id);
              }
            };

            return (
              <div key={c.id} className="flex flex-col items-center p-3 rounded border border-zinc-600 bg-zinc-800/50 relative">
                <div className="relative w-full rounded overflow-hidden bg-zinc-700 flex-shrink-0 mb-2 aspect-[7/5]">
                  <img
                    src={avatarSrc}
                    alt=""
                    className="block w-full h-full object-contain"
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
                <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden mb-1">
                  <div
                    className={`h-full transition-all ${
                      c.hp <= 0 ? 'bg-red-600' : c.hp < MAX_HP ? 'bg-amber-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${Math.max(0, (c.hp / MAX_HP) * 100)}%` }}
                  />
                </div>
                <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mb-2">
                  <div
                    className="h-full bg-sky-500/90 transition-all"
                    style={{ width: `${xpFill * 100}%` }}
                    title={`Опыт: ${xp} (нужно ${XP_PER_LEVEL} для уровня)`}
                  />
                </div>
                <div className="flex w-full items-center justify-center gap-1.5 gap-y-1 flex-wrap mb-0.5">
                  <p className="text-sm font-medium text-zinc-200 truncate text-center max-w-[min(100%,8rem)]">
                    {c.name}
                  </p>
                  <span className="text-zinc-500 font-normal text-xs shrink-0">Lv.{c.level ?? 1}</span>
                  {showLevelBtn && (
                    <button
                      type="button"
                      onClick={handleLevelClick}
                      className="shrink-0 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500 text-zinc-950 hover:bg-amber-400 shadow-lg animate-pulse"
                    >
                      Уровень!
                    </button>
                  )}
                </div>
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
      </div>
    </div>
  );
}
