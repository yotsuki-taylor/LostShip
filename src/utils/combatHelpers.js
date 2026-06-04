import { applyDeltas, getResourceLabels } from './resourceHelpers';
import { getJumpSuppliesDiscount } from './crewXp';

export const FLEE_COST = { energy: -30, supplies: -30 };
export const FLEE_BUTTON_COST_TEXT = (() => {
  const L = getResourceLabels();
  return `${L.energy.toLowerCase()}: ${FLEE_COST.energy}, ${L.supplies.toLowerCase()}: ${FLEE_COST.supplies}`;
})();

export function rollD6() {
  return Math.floor(Math.random() * 6) + 1;
}

export function rollNd6(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += rollD6();
  return sum;
}

export function getCrewStatusFromHp(hp) {
  if (hp <= 0) return 'убит';
  if (hp < 20) return 'ранен';
  return 'работает';
}

/** Побег в бою возможен только при подчинённом демоне (см. SHEET_FORMAT.md). */
export function isDemonSubordinate(demon) {
  if (demon == null || demon === '') return false;
  let s = String(demon).trim().replace(/^﻿/, '').normalize('NFKC');
  s = s.replace(/\s+/g, '').replace(/ё/gi, 'е').toLowerCase();
  if (s === 'подчинен') return true;
  // Редкий экспорт из таблиц: латиница вместо похожих кириллических букв
  const deLatin = s
    .replace(/e/g, 'е')
    .replace(/o/g, 'о')
    .replace(/a/g, 'а')
    .replace(/p/g, 'р')
    .replace(/c/g, 'с')
    .replace(/x/g, 'х')
    .replace(/y/g, 'у')
    .replace(/m/g, 'м')
    .replace(/t/g, 'т')
    .replace(/h/g, 'н')
    .replace(/n/g, 'н')
    .replace(/i/g, 'и')
    .replace(/d/g, 'д');
  return deLatin === 'подчинен';
}

/** Распределяет урон по корпусу (hull: -N) случайным образом между живыми членами команды */
export function distributeHullDamageToCrew(crew, hullDamageAmount) {
  if (hullDamageAmount <= 0 || !crew?.length) return crew;
  let nextCrew = crew.map((m) => ({ ...m, hp: m.hp ?? 0 }));
  for (let i = 0; i < hullDamageAmount; i++) {
    const aliveIndices = nextCrew
      .map((m, idx) => ((m.hp ?? 0) > 0 ? idx : -1))
      .filter((idx) => idx >= 0);
    if (aliveIndices.length === 0) break;
    const idx = aliveIndices[Math.floor(Math.random() * aliveIndices.length)];
    const m = nextCrew[idx];
    const nextHp = Math.max(0, m.hp - 1);
    nextCrew = [
      ...nextCrew.slice(0, idx),
      { ...m, hp: nextHp, status: getCrewStatusFromHp(nextHp) },
      ...nextCrew.slice(idx + 1),
    ];
  }
  return nextCrew;
}

/** После победы в бою: один раз переносит накопленный за бой урон корпуса в HP команды (50%); сбрасывает счётчик. */
export function applyAccumulatedCombatHullDamageToCrew(crew, accumRef) {
  const n = accumRef.current;
  accumRef.current = 0;
  if (n <= 0) return crew;
  const crewHullPoints = Math.max(0, Math.floor(n / 2));
  return distributeHullDamageToCrew(crew, crewHullPoints);
}

export function rollInitialCrewDamage(rawCrew) {
  return (rawCrew || []).map((member) => {
    const hp = Number.isFinite(member.hp) ? member.hp : 20;
    const maxDamage = Math.max(0, Math.min(8, hp - 1));
    const damage = maxDamage > 0 ? Math.floor(Math.random() * (maxDamage + 1)) : 0;
    const nextHp = Math.max(1, hp - damage);
    return {
      ...member,
      hp: nextHp,
      status: getCrewStatusFromHp(nextHp),
      xp: member.xp ?? 0,
      level: member.level ?? 1,
      skills: member.skills ?? [],
      pendingLevelQueue: member.pendingLevelQueue ?? [],
      pendingLevelChoice: member.pendingLevelChoice ?? null,
    };
  });
}

function isMedicMember(member) {
  const id = String(member?.id || '').toLowerCase();
  const role = String(member?.role || '').toLowerCase();
  return id === 'medic' || role.includes('medic') || role.includes('медик');
}

export function applyPassiveCrewEffects(rawCrew, currentResources, limits) {
  const crew = rawCrew || [];
  let squadHeal = 0;
  const resourceDelta = {};

  crew.forEach((member) => {
    const hp = member?.hp ?? 0;
    if (hp <= 0) return;

    // Особое правило для медика: при ранении лечит слабее.
    if (isMedicMember(member) && member?.status === 'ранен') {
      squadHeal += 1;
      return;
    }

    const isWorking = member?.status === 'работает';
    if (!isWorking || !member?.passiveEffect) return;

    Object.entries(member.passiveEffect).forEach(([key, value]) => {
      if (typeof value !== 'number') return;
      if (key === 'hp') {
        squadHeal += value;
      } else {
        resourceDelta[key] = (resourceDelta[key] ?? 0) + value;
      }
    });
  });

  const nextCrew = squadHeal > 0
    ? crew.map((member) => {
        if ((member.hp ?? 0) <= 0) return member;
        const nextHp = Math.min(20, (member.hp ?? 0) + squadHeal);
        return { ...member, hp: nextHp, status: getCrewStatusFromHp(nextHp) };
      })
    : crew;

  const nextResources = Object.keys(resourceDelta).length > 0
    ? applyDeltas(currentResources, resourceDelta, limits)
    : currentResources;

  return { crew: nextCrew, resources: nextResources };
}

export function buildJumpSuppliesCost(gameCrew) {
  const discount = getJumpSuppliesDiscount(gameCrew);
  return { supplies: -(Math.max(0, 5 - discount)) };
}
