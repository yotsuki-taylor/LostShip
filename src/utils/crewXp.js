/** Система XP / уровней команды (см. задачу: 5 XP за награду, уровень каждые 5 XP). */

export const XP_PER_LEVEL = 5;
export const TEAM_XP_REWARD = 5;

/** Нормализация члена команды из сохранения. */
export function normalizeCrewMember(m) {
  if (!m || typeof m !== 'object') return m;
  const queue = Array.isArray(m.pendingLevelQueue)
    ? m.pendingLevelQueue
    : m.pendingLevelChoice
      ? [m.pendingLevelChoice]
      : [];
  return {
    ...m,
    xp: Math.max(0, Number(m.xp) || 0),
    level: Math.max(1, Number(m.level) || 1),
    skills: Array.isArray(m.skills) ? m.skills : [],
    pendingLevelQueue: queue,
    pendingLevelChoice: queue[0] ?? null,
  };
}

export function findCrewTemplate(memberId, crewTemplateRows) {
  if (!crewTemplateRows?.length) return null;
  const sid = String(memberId ?? '');
  return crewTemplateRows.find((r) => String(r.id ?? '') === sid) ?? null;
}

function mergePassiveEffects(base, extra) {
  if (!extra || typeof extra !== 'object') return base || null;
  const out = { ...(base || {}) };
  Object.entries(extra).forEach(([k, v]) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = (out[k] ?? 0) + v;
    }
  });
  return Object.keys(out).length ? out : null;
}

/**
 * Парсит текст навыка из таблицы в эффект для боёв/хода/прыжка.
 */
export function parseSkillEffect(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();

  let m = t.match(/\+(\d+)[^\d]*(?:2d6|к\s*броску|к\s*урону)|(?:2d6|урон)[^\d]*\+(\d+)/);
  if (m) return { type: 'combat', attackBonus: Number(m[1] || m[2]) };

  m = t.match(/урон[а]?[^\d]*(\d+)|(\d+)[^\d]*урон/);
  if (m && /2d6|куб|бросок/.test(t)) return { type: 'combat', attackBonus: Number(m[1] || m[2]) };

  m = t.match(/(\d+)[^\d]*энерг|энерг[^\d]*(\d+)/);
  if (m && /начал|ход|кажд|восстанов/.test(t)) {
    return { type: 'resource', energy: Number(m[1] || m[2]) };
  }

  m = t.match(/прыжок[^\d]*(\d+)[^\d]*припас|припас[^\d]*(\d+)[^\d]*меньш|минус\s*(\d+)[^\d]*припас/);
  if (m) return { type: 'jump', suppliesDiscount: Number(m[1] || m[2] || m[3]) };

  m = t.match(/на\s*(\d+)\s*припас|припас[^\d]*(\d+)[^\d]*меньше/);
  if (m && /прыжок|jump|warp/.test(t)) {
    return { type: 'jump', suppliesDiscount: Number(m[1] || m[2]) };
  }

  return { type: 'unknown', raw: text };
}

/** Суммарный бонус к урону атаки (2d6) от навыков живых членов команды. */
export function getCombatAttackBonus(crew) {
  if (!crew?.length) return 0;
  let sum = 0;
  crew.forEach((m) => {
    if ((m.hp ?? 0) <= 0) return;
    (m.skills || []).forEach((s) => {
      const e = s?.effect;
      if (e?.type === 'combat' && typeof e.attackBonus === 'number') sum += e.attackBonus;
    });
  });
  return sum;
}

/** Бонус энергии (и др.) в начале «хода» после ивента. */
export function getTurnStartSkillResourceDelta(crew) {
  const delta = {};
  if (!crew?.length) return delta;
  crew.forEach((m) => {
    if ((m.hp ?? 0) <= 0 || m.status === 'убит') return;
    (m.skills || []).forEach((s) => {
      const e = s?.effect;
      if (e?.type === 'resource') {
        if (typeof e.energy === 'number') delta.energy = (delta.energy ?? 0) + e.energy;
        if (typeof e.supplies === 'number') delta.supplies = (delta.supplies ?? 0) + e.supplies;
        if (typeof e.morale === 'number') delta.morale = (delta.morale ?? 0) + e.morale;
        if (typeof e.hull === 'number') delta.hull = (delta.hull ?? 0) + e.hull;
      }
    });
  });
  return delta;
}

/** Скидка припасов на прыжок (сумма по команде). */
export function getJumpSuppliesDiscount(crew) {
  if (!crew?.length) return 0;
  let sum = 0;
  crew.forEach((m) => {
    if ((m.hp ?? 0) <= 0) return;
    (m.skills || []).forEach((s) => {
      const e = s?.effect;
      if (e?.type === 'jump' && typeof e.suppliesDiscount === 'number') sum += e.suppliesDiscount;
    });
  });
  return sum;
}

/**
 * Случайно распределяет amount очков XP между живыми, обрабатывает уровни.
 * crewTemplateRows — строки из таблицы (с levelPassives / levelOptions).
 */
export function applyTeamXpReward(gameCrew, crewTemplateRows) {
  const logLines = [];
  let next = (gameCrew || []).map((m) => ({ ...normalizeCrewMember(m) }));

  const aliveIdx = next.map((m, i) => ((m.hp ?? 0) > 0 ? i : -1)).filter((i) => i >= 0);
  if (aliveIdx.length === 0) {
    return { crew: next, logLines };
  }

  const gains = {};
  for (let k = 0; k < TEAM_XP_REWARD; k++) {
    const pick = aliveIdx[Math.floor(Math.random() * aliveIdx.length)];
    const id = String(next[pick].id ?? pick);
    gains[id] = (gains[id] ?? 0) + 1;
    next[pick] = { ...next[pick], xp: (next[pick].xp ?? 0) + 1 };
  }

  const xpBefore = {};
  next.forEach((m) => {
    xpBefore[String(m.id ?? '')] = m.xp ?? 0;
  });

  Object.keys(gains).forEach((idKey) => {
    const idx = next.findIndex((m) => String(m.id ?? '') === idKey);
    if (idx >= 0) {
      const n = gains[idKey];
      const name = next[idx].name || 'Боец';
      logLines.push(`${name} получил ${n} очков опыта`);
    }
  });

  next.forEach((m) => {
    const id = String(m.id ?? '');
    const wasBelow = (xpBefore[id] ?? 0) < XP_PER_LEVEL;
    const nowOk = (m.xp ?? 0) >= XP_PER_LEVEL;
    if (wasBelow && nowOk && (m.hp ?? 0) > 0) {
      logLines.push(`${m.name || 'Боец'} готов к повышению уровня.`);
    }
  });

  return { crew: next, logLines };
}

const SLUG_NORM = (s) =>
  String(s ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');

/**
 * Начисляет XP конкретным бойцам по ключам из последствий ивентов: navigator_XP, captain_XP и т.д.
 * slug в JSON — латиница; сопоставление: id бойца (без учёта регистра) или точное совпадение нормализованной role.
 */
export function applyCrewMemberXpBySlug(gameCrew, crewMemberXpMap, _crewTemplateRows) {
  if (!crewMemberXpMap || typeof crewMemberXpMap !== 'object') return { crew: gameCrew, logLines: [] };

  const entries = Object.entries(crewMemberXpMap).filter(([, v]) => {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n !== 0;
  });
  if (entries.length === 0) return { crew: gameCrew, logLines: [] };

  let next = (gameCrew || []).map((m) => ({ ...normalizeCrewMember(m) }));
  const xpBefore = {};
  next.forEach((m) => {
    xpBefore[String(m.id ?? '')] = m.xp ?? 0;
  });

  const logLines = [];

  entries.forEach(([slugRaw, rawVal]) => {
    const amount = typeof rawVal === 'number' ? rawVal : parseInt(String(rawVal), 10);
    if (!Number.isFinite(amount) || amount === 0) return;
    const want = SLUG_NORM(slugRaw);
    const idx = next.findIndex((m) => {
      if ((m.hp ?? 0) <= 0) return false;
      const id = SLUG_NORM(m.id ?? '');
      const role = SLUG_NORM(m.role ?? '');
      return id === want || role === want;
    });
    if (idx < 0) return;

    const m = { ...next[idx] };
    const prev = m.xp ?? 0;
    m.xp = Math.max(0, prev + amount);
    next[idx] = m;

    const name = m.name || 'Боец';
    const sign = amount > 0 ? 'получил' : 'потерял';
    logLines.push(`${name} ${sign} ${Math.abs(amount)} очков опыта`);
  });

  next.forEach((m) => {
    const id = String(m.id ?? '');
    const wasBelow = (xpBefore[id] ?? 0) < XP_PER_LEVEL;
    const nowOk = (m.xp ?? 0) >= XP_PER_LEVEL;
    if (wasBelow && nowOk && (m.hp ?? 0) > 0) {
      logLines.push(`${m.name || 'Боец'} готов к повышению уровня.`);
    }
  });

  return { crew: next, logLines };
}

/**
 * Ручное повышение уровня (списать XP, применить пассив, поставить в очередь выбор навыка).
 * Сообщение в лог о возможности уровня выводится при наборе XP (см. applyTeamXpReward / applyCrewMemberXpBySlug).
 */
export function executeManualLevelUp(gameCrew, memberId, crewTemplateRows) {
  const list = (gameCrew || []).map((m) => ({ ...normalizeCrewMember(m) }));
  const idx = list.findIndex((m) => String(m.id ?? '') === String(memberId));
  if (idx < 0) return { crew: gameCrew, logLines: [] };

  let m = { ...list[idx] };
  if ((m.hp ?? 0) <= 0) return { crew: gameCrew, logLines: [] };
  if ((m.xp ?? 0) < XP_PER_LEVEL) return { crew: gameCrew, logLines: [] };

  const queue = [...(m.pendingLevelQueue || [])];

  m.xp = (m.xp ?? 0) - XP_PER_LEVEL;
  m.level = (m.level ?? 1) + 1;
  const newLevel = m.level;

  const tpl = findCrewTemplate(m.id, crewTemplateRows);
  const pass = tpl?.levelPassives?.[newLevel];
  if (pass && typeof pass === 'object') {
    m.passiveEffect = mergePassiveEffects(m.passiveEffect, pass);
  }

  const opt1 = tpl?.levelOptions?.[newLevel]?.opt1 ?? '';
  const opt2 = tpl?.levelOptions?.[newLevel]?.opt2 ?? '';
  if (opt1.trim() || opt2.trim()) {
    queue.push({ level: newLevel, opt1: opt1.trim() || '—', opt2: opt2.trim() || '—' });
  }

  m.pendingLevelQueue = queue;
  m.pendingLevelChoice = queue[0] ?? null;

  list[idx] = m;
  return { crew: list, logLines: [] };
}

/** Подтверждение выбора в окне прокачки: optIndex 1 или 2. */
export function confirmLevelSkillChoice(crew, memberId, optIndex) {
  const list = crew.map((m) => ({ ...m }));
  const idx = list.findIndex((m) => String(m.id ?? '') === String(memberId));
  if (idx < 0) return crew;

  const m = list[idx];
  const queue = [...(m.pendingLevelQueue || [])];
  const pending = queue[0];
  if (!pending) return crew;

  const text = optIndex === 2 ? pending.opt2 : pending.opt1;
  const effect = parseSkillEffect(text);
  const skills = [...(m.skills || [])];
  skills.push({ text, effect, level: pending.level, pickedAt: optIndex });

  queue.shift();
  list[idx] = {
    ...m,
    skills,
    pendingLevelQueue: queue,
    pendingLevelChoice: queue[0] ?? null,
  };
  return list;
}
