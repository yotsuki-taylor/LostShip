import React, { useState, useEffect } from 'react';
import { XP_PER_LEVEL, isCrewMemberAlive } from '../utils/crewXp';
import { getResourceLabels } from '../utils/resourceHelpers';

const MAX_HP = 20;

/** Склонение «N припас(ов/а)» для фразы про пассив */
function suppliesDeclensionRu(n) {
  const abs = Math.abs(Math.floor(Number(n) || 0));
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return 'припасов';
  const mod10 = abs % 10;
  if (mod10 === 1) return 'припас';
  if (mod10 >= 2 && mod10 <= 4) return 'припаса';
  return 'припасов';
}

const PASSIVE_KEY_ORDER = ['hp', 'hull', 'energy', 'supplies', 'morale', 'speed', 'attack', 'survey'];

/** Строки «Пассивно восстанавливает N … в ход» по объекту passiveEffect (только положительные значения). */
function passiveRestoreLines(passiveEffect) {
  if (!passiveEffect || typeof passiveEffect !== 'object') return [];
  const labels = getResourceLabels();
  const keys = Object.keys(passiveEffect).filter((k) => {
    const v = passiveEffect[k];
    return typeof v === 'number' && v > 0;
  });
  keys.sort((a, b) => {
    const ia = PASSIVE_KEY_ORDER.indexOf(String(a).toLowerCase());
    const ib = PASSIVE_KEY_ORDER.indexOf(String(b).toLowerCase());
    if (ia === -1 && ib === -1) return String(a).localeCompare(String(b));
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
  return keys.map((k) => formatPassiveRestoreLine(k, passiveEffect[k], labels)).filter(Boolean);
}

function formatPassiveRestoreLine(key, value, labels) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  const k = String(key || '').toLowerCase();
  if (k === 'hp') return `Пассивно восстанавливает ${n} HP экипажу в ход`;
  if (k === 'supplies') return `Пассивно восстанавливает ${n} ${suppliesDeclensionRu(n)} в ход`;
  const genitive = {
    hull: 'прочности',
    energy: 'энергии',
    morale: 'морали',
    speed: 'скорости',
    attack: 'атаки',
    survey: 'разведки',
  };
  if (genitive[k]) return `Пассивно восстанавливает ${n} ${genitive[k]} в ход`;
  const lab = labels[k];
  if (lab) return `Пассивно восстанавливает ${n} (${lab.toLowerCase()}) в ход`;
  return `Пассивно восстанавливает ${n} (${k}) в ход`;
}

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
  /** id → показана карточка навыков вместо аватарки */
  const [skillsCardOpenById, setSkillsCardOpenById] = useState({});

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
                {modalMember.pendingLevelChoice?.opt1Label?.trim() ||
                  modalMember.pendingLevelChoice?.opt1 ||
                  '—'}
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
                {modalMember.pendingLevelChoice?.opt2Label?.trim() ||
                  modalMember.pendingLevelChoice?.opt2 ||
                  '—'}
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
            const alive = isCrewMemberAlive(c);
            const xp = Math.max(0, c.xp ?? 0);
            const xpFill = Math.min(xp, XP_PER_LEVEL) / XP_PER_LEVEL;
            const pendingSkill = c.pendingLevelChoice || (c.pendingLevelQueue && c.pendingLevelQueue[0]);
            const hasSkillPick = pendingSkill && (pendingSkill.opt1 || pendingSkill.opt2);
            const canManualLevel = alive && xp >= XP_PER_LEVEL;
            const showLevelBtn = alive && (hasSkillPick || canManualLevel);

            const handleLevelClick = (e) => {
              e.stopPropagation();
              if (hasSkillPick) {
                setModalMember({ ...c, pendingLevelChoice: pendingSkill });
              } else if (canManualLevel) {
                onManualLevelUp(c.id);
              }
            };

            const memberKey = String(c.id ?? '');
            const showSkillsCard = !!skillsCardOpenById[memberKey];
            const skillsList = Array.isArray(c.skills) ? c.skills : [];
            const passiveLines = passiveRestoreLines(c.passiveEffect);

            const toggleAvatarSkillsCard = (e) => {
              e.stopPropagation();
              setSkillsCardOpenById((prev) => ({
                ...prev,
                [memberKey]: !prev[memberKey],
              }));
            };

            return (
              <div key={c.id} className="flex flex-col items-center p-3 rounded border border-zinc-600 bg-zinc-800/50 relative">
                <div className="relative w-full rounded overflow-hidden bg-zinc-700 flex-shrink-0 mb-2 aspect-[7/5]">
                  <button
                    type="button"
                    onClick={toggleAvatarSkillsCard}
                    className="group absolute inset-0 w-full h-full p-0 border-0 bg-transparent cursor-pointer text-left rounded overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 focus-visible:ring-inset"
                    aria-label={showSkillsCard ? 'Показать аватар' : 'Показать навыки'}
                  >
                    {!showSkillsCard ? (
                      <>
                        <img
                          src={avatarSrc}
                          alt=""
                          className="pointer-events-none block w-full h-full object-contain"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            const fb = e.target.parentElement?.querySelector('.avatar-fallback');
                            if (fb) fb.classList.remove('hidden');
                          }}
                        />
                        <div className="avatar-fallback pointer-events-none absolute inset-0 hidden flex items-center justify-center text-zinc-500 text-2xl bg-zinc-700">
                          ?
                        </div>
                      </>
                    ) : (
                      <div className="absolute inset-0 flex flex-col bg-zinc-900/95 border border-amber-600/35 rounded overflow-hidden shadow-inner">
                        <div className="shrink-0 px-2 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500/90 border-b border-zinc-700/80">
                          Навыки
                        </div>
                        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1.5 space-y-1.5 text-[10px] leading-snug text-zinc-300">
                          {passiveLines.length === 0 && skillsList.length === 0 ? (
                            <li className="text-zinc-500 italic">Нет выбранных навыков</li>
                          ) : (
                            <>
                              {passiveLines.map((line, pi) => (
                                <li
                                  key={`${memberKey}-passive-${pi}`}
                                  className={`pb-1.5 text-emerald-400/95 ${
                                    pi === passiveLines.length - 1 && skillsList.length === 0
                                      ? ''
                                      : 'border-b border-zinc-700/40'
                                  }`}
                                >
                                  {line}
                                </li>
                              ))}
                              {skillsList.map((s, si) => (
                                <li
                                  key={`${memberKey}-skill-${si}`}
                                  className="border-b border-zinc-700/40 pb-1.5 last:border-b-0 last:pb-0"
                                >
                                  {s.text || s.raw || '—'}
                                </li>
                              ))}
                            </>
                          )}
                        </ul>
                      </div>
                    )}
                  </button>
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
                    className={`h-full transition-all ${alive ? 'bg-sky-500/90' : 'bg-zinc-500/80'}`}
                    style={{ width: `${xpFill * 100}%` }}
                    title={
                      alive
                        ? `Опыт: ${xp} (нужно ${XP_PER_LEVEL} для уровня)`
                        : `Опыт: ${xp} (погибший — опыт не начисляется)`
                    }
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
