import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { getResourceLimits, getResourceLabels, RESOURCE_UNITS, DELTA_KEYS, STATUS_VAR_KEYS, applyDeltas, applyDifficultyToDeltas, normalizeDeltaToNewFormat, FIXED_SPEED, FIXED_ATTACK } from './utils/resourceHelpers';
import { saveGame, loadGame, hasSave, clearSave, migrateResources } from './utils/saveGame';
import {
  createInitialMapState,
  performJump,
  serializeMapState,
  deserializeMapState,
  isExitNode,
  NODE_TYPE,
  rollNodeType,
  ensureSurveyRevealTypes,
} from './utils/mapUtils';
import { matchesEventReq, pickCrewNames, pickCriticalEvent } from './services/sheetLoader';
import {
  applyTeamXpReward,
  applyCrewMemberXpBySlug,
  getCombatAttackBonus,
  getTurnStartSkillResourceDelta,
  getJumpSuppliesDiscount,
  confirmLevelSkillChoice,
  normalizeCrewMember,
  executeManualLevelUp,
} from './utils/crewXp';
import { useSheetData } from './hooks/useSheetData';
import { DEFAULT_SHIP_STATS } from './services/sheetLoader';
import { InfoPanel } from './components/InfoPanel';
import { EventLog } from './components/EventLog';
import { EventPopup } from './components/EventPopup';
import { IntroPopup } from './components/IntroPopup';
import { StartMenu } from './components/StartMenu';
import { ShipDisplay } from './components/ShipDisplay';
import { MapPopup } from './components/MapPopup';
import { CrewPopup } from './components/CrewPopup';


const INITIAL_PLAYER_VARS = {
  ship: null,
  guest: null,
  dest: null,
  demon: 'сбежал',
  engine: 'поврежден',
  ship_mage: 'ранен',
  dest_lighthouse: 'undone',
  dest_demon: 'undone',
  victory: null,
};

/** Побег в бою возможен только при подчинённом демоне (см. SHEET_FORMAT.md). */
function isDemonSubordinate(demon) {
  if (demon == null || demon === '') return false;
  let s = String(demon).trim().replace(/^\uFEFF/, '').normalize('NFKC');
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

const COMBAT_EXTRA_LABELS = { enemy_damage: 'Урон врагу' };
const FLEE_COST = { energy: -30, supplies: -30 };
const FLEE_BUTTON_COST_TEXT = (() => {
  const L = getResourceLabels();
  return `${L.energy.toLowerCase()}: ${FLEE_COST.energy}, ${L.supplies.toLowerCase()}: ${FLEE_COST.supplies}`;
})();

function formatDeltaForLog(delta, extra = {}) {
  const combined = normalizeDeltaToNewFormat({ ...delta, ...extra });
  const labels = { ...getResourceLabels(), ...COMBAT_EXTRA_LABELS };
  const parts = [];
  Object.entries(combined).forEach(([key, val]) => {
    if (val === 0 || val === undefined) return;
    const label = labels[key] ?? key;
    const unit = RESOURCE_UNITS[key] ?? '';
    const sign = val > 0 ? '+' : '';
    parts.push(`${label}: ${sign}${val}${unit}`);
  });
  if (extra.enemy_damage > 0 && !combined.enemy_damage) parts.push(`${COMBAT_EXTRA_LABELS.enemy_damage}: ${extra.enemy_damage}`);
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}

const MUSIC_PATH = '/LostShip/sound/maintheme.mp3';
const MUSIC_PREF_KEY = 'lost-ship-music';

function getMusicEnabled() {
  try {
    const v = localStorage.getItem(MUSIC_PREF_KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

function saveMusicPreference(enabled) {
  try {
    localStorage.setItem(MUSIC_PREF_KEY, enabled ? '1' : '0');
  } catch {}
}

function withFixedShipStats(resources) {
  return { ...resources, speed: FIXED_SPEED, attack: FIXED_ATTACK };
}

function rollD6() {
  return Math.floor(Math.random() * 6) + 1;
}
function rollNd6(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += rollD6();
  return sum;
}

function getCrewStatusFromHp(hp) {
  if (hp <= 0) return 'убит';
  if (hp < 20) return 'ранен';
  return 'работает';
}

function isMedicMember(member) {
  const id = String(member?.id || '').toLowerCase();
  const role = String(member?.role || '').toLowerCase();
  return id === 'medic' || role.includes('medic') || role.includes('медик');
}

function rollInitialCrewDamage(rawCrew) {
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

function buildJumpSuppliesCost(gameCrew) {
  const discount = getJumpSuppliesDiscount(gameCrew);
  return { supplies: -(Math.max(0, 5 - discount)) };
}

/** Распределяет урон по корпусу (hull: -N) случайным образом между живыми членами команды */
function distributeHullDamageToCrew(crew, hullDamageAmount) {
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
function applyAccumulatedCombatHullDamageToCrew(crew, accumRef) {
  const n = accumRef.current;
  accumRef.current = 0;
  if (n <= 0) return crew;
  const crewHullPoints = Math.max(0, Math.floor(n / 2));
  return distributeHullDamageToCrew(crew, crewHullPoints);
}

function applyPassiveCrewEffects(rawCrew, currentResources, limits) {
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

export default function App() {
  const { events, introSlides, shipStats, crew, fights, criticalPenalties, fromSheet, loading } = useSheetData();
  const audioRef = useRef(null);

  const [showMenu, setShowMenu] = useState(true);
  const [resources, setResources] = useState(DEFAULT_SHIP_STATS);
  const [turn, setTurn] = useState(0);
  const [eventLog, setEventLog] = useState([]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [isEventActive, setIsEventActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [introStep, setIntroStep] = useState(0);
  const [playerVars, setPlayerVars] = useState(INITIAL_PLAYER_VARS);
  const [showMapPopup, setShowMapPopup] = useState(false);
  const [showCrewPopup, setShowCrewPopup] = useState(false);
  const [crewSkillModalMember, setCrewSkillModalMember] = useState(null);
  const [gameCrew, setGameCrew] = useState([]);
  const [pendingCrewInit, setPendingCrewInit] = useState(false);
  const [mapState, setMapState] = useState(null);
  const mapSurvey = useMemo(
    () => Math.max(0, Math.floor(Number(resources?.survey ?? DEFAULT_SHIP_STATS.survey ?? 0))),
    [resources?.survey]
  );

  useEffect(() => {
    if (!mapState) return;
    if (mapSurvey <= 0) return;
    const next = ensureSurveyRevealTypes(mapState, mapSurvey);
    if (next !== mapState) setMapState(next);
  }, [mapState, mapSurvey]);

  const [isWarping, setIsWarping] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(getMusicEnabled);
  const [nextDestByDestination, setNextDestByDestination] = useState({ lighthouse: 1, demon: 1 });
  const [shownEventIds, setShownEventIds] = useState([]);
  const [currentFight, setCurrentFight] = useState(null);
  const [combatTurn, setCombatTurn] = useState(0);
  const [enemyHp, setEnemyHp] = useState(0);
  const [combatEvent, setCombatEvent] = useState(null);
  const [pendingFightEnd, setPendingFightEnd] = useState(null);
  const [pendingCombatAction, setPendingCombatAction] = useState(null);
  const [playerHitTrigger, setPlayerHitTrigger] = useState(0);
  const [enemyHitTrigger, setEnemyHitTrigger] = useState(0);
  const [ramTrigger, setRamTrigger] = useState(0);
  const [screenShake, setScreenShake] = useState(false);
  const [ramShake, setRamShake] = useState(false);
  const [currentCriticalResource, setCurrentCriticalResource] = useState(null);

  const getCriticalResource = useCallback((afterResources, pv) => {
    const check = (key) => (afterResources[key] ?? 0) <= 0 && !pv[`critical_${key}_0`];
    if (check('supplies')) return 'supplies';
    if (check('energy')) return 'energy';
    if (check('morale')) return 'morale';
    return null;
  }, []);

  useEffect(() => {
    if (!resources) return;
    const toClear = {};
    if ((resources.supplies ?? 0) > 0 && playerVars.critical_supplies_0) toClear.critical_supplies_0 = false;
    if ((resources.energy ?? 0) > 0 && playerVars.critical_energy_0) toClear.critical_energy_0 = false;
    if ((resources.morale ?? 0) > 0 && playerVars.critical_morale_0) toClear.critical_morale_0 = false;
    if (Object.keys(toClear).length > 0) setPlayerVars((p) => ({ ...p, ...toClear }));
  }, [resources?.supplies, resources?.energy, resources?.morale, playerVars.critical_supplies_0, playerVars.critical_energy_0, playerVars.critical_morale_0]);

  useEffect(() => {
    if (playerHitTrigger <= 0) return;
    setScreenShake(true);
    const t = setTimeout(() => setScreenShake(false), 350);
    return () => clearTimeout(t);
  }, [playerHitTrigger]);

  useEffect(() => {
    if (ramTrigger <= 0) return;
    setRamShake(true);
    const t = setTimeout(() => setRamShake(false), 500);
    return () => clearTimeout(t);
  }, [ramTrigger]);
  const pendingJumpRef = useRef(null);
  /** Суммарный урон корпуса за бой; при победе половина (floor) переносится в HP команды */
  const combatCrewHullDamageAccumRef = useRef(0);

  const getEventKey = useCallback((e) => `${(e?.event || '').toLowerCase()}-${e?.id ?? e?.title ?? ''}`, []);

  const limits = useMemo(() => getResourceLimits(), []);

  const handleMusicToggle = useCallback(() => {
    setMusicEnabled((prev) => {
      const next = !prev;
      saveMusicPreference(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [showMenu]);

  // Синхронизация ресурсов со статами из таблицы при загрузке (для меню и новой игры)
  useEffect(() => {
    if (shipStats && showMenu) {
      setResources(withFixedShipStats(shipStats));
    }
  }, [shipStats, showMenu]);

  // Мобильный сценарий: если новая игра стартовала до загрузки Crew, дозаполняем команду позже.
  useEffect(() => {
    if (!pendingCrewInit) return;
    if (showMenu) return;
    if (!crew || crew.length === 0) return;
    setGameCrew(rollInitialCrewDamage(pickCrewNames(crew)));
    setPendingCrewInit(false);
  }, [pendingCrewInit, showMenu, crew]);

  const isGameOver = (resources.hull ?? 0) <= 0;
  const isVictory = playerVars.victory === 'yes' || playerVars.victory === '1' || playerVars.victory === true;

  useEffect(() => {
    if (isGameOver) clearSave();
  }, [isGameOver]);

  const isDestinationEvent = useCallback((e) => {
    const ev = (e?.event || '').toLowerCase();
    return ev === 'destination_lighthouse' || ev === 'destination_demon';
  }, []);

  const pickStoryEvent = useCallback(
    (nextDestId, shownSet, currentTurn) => {
      const dest = playerVars.dest;
      const destKey = dest === 'lighthouse' ? 'lighthouse' : dest === 'demon' ? 'demon' : null;
      const destEvents = events
        .filter((e) => {
          const ev = (e?.event || '').toLowerCase();
          if (ev === 'destination_lighthouse') return dest === 'lighthouse';
          if (ev === 'destination_demon') return dest === 'demon';
          if (ev === 'final') return true;
          return false;
        })
        .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
      const notShown = (e) => !shownSet.has(getEventKey(e));
      const availableDest = destEvents.filter(notShown);
      const destById = (id) => destEvents.find((e) => Number(e.id) === Number(id));
      const destByIdAvailable = (id) => availableDest.find((e) => Number(e.id) === Number(id));
      if (!destKey) return null;
      if (nextDestId === 1 && destById(1)) return (destByIdAvailable(1) ?? destById(1));
      if (nextDestId === 6) {
        const finalReady = playerVars.dest_lighthouse === 'done' && playerVars.dest_demon === 'done';
        if (finalReady) {
          const finalEvent = events.find((e) => (e?.event || '').toLowerCase() === 'final' && matchesEventReq(e.event_req, playerVars, resources));
          if (finalEvent && notShown(finalEvent)) return finalEvent;
        }
        if (destById(6)) return (destByIdAvailable(6) ?? destById(6));
      }
      const useDest = destById(nextDestId);
      const useDestAvailable = destByIdAvailable(nextDestId) ?? useDest;
      return useDestAvailable ?? null;
    },
    [events, playerVars, resources, getEventKey]
  );

  const pickRandomEvent = useCallback(
    (shownSet) => {
      const randomEvents = events.filter(
        (e) => (e?.event || '').toLowerCase() === 'random' && matchesEventReq(e.event_req, playerVars, resources)
      );
      const notShown = (e) => !shownSet.has(getEventKey(e));
      const available = randomEvents.filter(notShown);
      const pool = available.length > 0 ? available : randomEvents;
      return pool[Math.floor(Math.random() * pool.length)] ?? null;
    },
    [events, playerVars, resources, getEventKey]
  );

  const pickMarketEvent = useCallback(
    () => {
      const marketEvents = events.filter(
        (e) => (e?.event || '').toLowerCase() === 'market' && matchesEventReq(e.event_req, playerVars, resources)
      );
      return marketEvents[Math.floor(Math.random() * marketEvents.length)] ?? null;
    },
    [events, playerVars, resources]
  );

  const findEventByIdOrTitle = useCallback(
    (ref) => {
      if (!ref || !events?.length) return null;
      const s = String(ref).trim();
      return events.find((e) => String(e.id) === s || (e.event || '').trim() === s || (e.title || '').trim() === s) || null;
    },
    [events]
  );

  const handleCrewManualLevelUp = useCallback(
    (memberId) => {
      const r = executeManualLevelUp(gameCrew, memberId, crew);
      setGameCrew(r.crew);
      if (r.logLines?.length) {
        setEventLog((e) => [...e.slice(-5), ...r.logLines].slice(-5));
      }
      const mem = r.crew.find((m) => String(m.id) === String(memberId));
      if (mem?.pendingLevelChoice && (mem.pendingLevelChoice.opt1 || mem.pendingLevelChoice.opt2)) {
        setCrewSkillModalMember(mem);
      } else {
        setCrewSkillModalMember(null);
      }
    },
    [crew, gameCrew]
  );

  const handleMapNodeClick = useCallback(
    (targetNodeId) => {
      if (isEventActive || isGameOver || isVictory || currentFight || !mapState) return;
      pendingJumpRef.current = targetNodeId;
      setShowMapPopup(false);
      setIsWarping(true);
    },
    [isEventActive, isGameOver, isVictory, currentFight, mapState]
  );

  const handleWarpEnd = useCallback(() => {
    const targetNodeId = pendingJumpRef.current;
    pendingJumpRef.current = null;
    setIsWarping(false);
    if (targetNodeId == null || !mapState) return;

    const reachedExit = isExitNode(mapState.nodes, targetNodeId);
    const nextMapState = performJump(mapState, targetNodeId);
    if (!nextMapState) return;

    const isReturnToVisited = !reachedExit && mapState.visitedIds?.has(targetNodeId);
    const passiveApplied = applyPassiveCrewEffects(gameCrew, resources, limits);
    const nextCrew = passiveApplied.crew;
    const afterPassiveResources = passiveApplied.resources;
    const jumpCost = buildJumpSuppliesCost(nextCrew);
    let tickResources = applyDeltas(afterPassiveResources, jumpCost, limits);
    let criticalRes = getCriticalResource(tickResources, playerVars);
    const jumpPenalties = {};
    if (criticalRes !== 'supplies' && (tickResources.supplies ?? 0) <= 0 && playerVars.critical_supplies_0) {
      Object.assign(jumpPenalties, criticalPenalties?.supplies ?? {});
    }
    if (criticalRes !== 'energy' && (tickResources.energy ?? 0) <= 0 && playerVars.critical_energy_0) {
      Object.assign(jumpPenalties, criticalPenalties?.energy ?? {});
    }
    if (criticalRes !== 'morale' && (tickResources.morale ?? 0) <= 0 && playerVars.critical_morale_0) {
      Object.assign(jumpPenalties, criticalPenalties?.morale ?? {});
    }
    if (Object.keys(jumpPenalties).length > 0) {
      Object.assign(jumpCost, jumpPenalties);
      tickResources = applyDeltas(afterPassiveResources, jumpCost, limits);
      criticalRes = getCriticalResource(tickResources, playerVars);
    }
    const jumpHullDamage = (jumpCost.hull ?? 0) < 0 ? Math.abs(Math.round(jumpCost.hull)) : 0;
    const finalCrew = jumpHullDamage > 0 ? distributeHullDamageToCrew(nextCrew, jumpHullDamage) : nextCrew;

    setGameCrew(finalCrew);
    setResources(tickResources);

    const willShowEvent = events.length > 0 && !isReturnToVisited;

    const calmDelta = formatDeltaForLog(jumpCost);
    const jumpMsg = isReturnToVisited
        ? `Возврат к узлу ${targetNodeId}.${calmDelta}`
      : reachedExit
        ? `Прыжок к выходу.${calmDelta}`
        : `Прыжок к узлу ${targetNodeId}.${calmDelta}`;
    let newEventLog = [...eventLog.slice(-5), jumpMsg].slice(-5);
    if (Object.keys(jumpPenalties).length > 0) {
      newEventLog = [...newEventLog.slice(-5), 'Штрафы за критические ресурсы применены.'].slice(-5);
    }

    setEventLog(newEventLog);

    const destKey = playerVars.dest === 'lighthouse' ? 'lighthouse' : playerVars.dest === 'demon' ? 'demon' : 'lighthouse';
    const currentNextDestId = nextDestByDestination[destKey] ?? 1;
    let newNextDestByDest = { ...nextDestByDestination };
    let newShownIds = shownEventIds;
    let finalMapState = nextMapState;
    setMapState(nextMapState);
    let finalCurrentFight = currentFight;
    let finalCombatTurn = combatTurn;
    let finalEnemyHp = enemyHp;

    if (criticalRes) {
      const criticalEvent = pickCriticalEvent(events, criticalRes, tickResources, playerVars);
      if (criticalEvent) {
        setCurrentEvent(criticalEvent);
        setCurrentCriticalResource(criticalRes);
        setIsEventActive(true);
      }
    } else if (willShowEvent) {
      const nodeTypes = nextMapState.nodeTypes ?? {};
      let nodeType = nodeTypes[targetNodeId];
      if (nodeType == null) {
        nodeType = rollNodeType();
        finalMapState = { ...nextMapState, nodeTypes: { ...nodeTypes, [targetNodeId]: nodeType } };
      }

      const shownSet = new Set(shownEventIds);
      if (nodeType === NODE_TYPE.COMBAT && !fights?.length) nodeType = NODE_TYPE.RANDOM;

      if (nodeType === NODE_TYPE.COMBAT && fights?.length > 0) {
        const fightData = fights[Math.floor(Math.random() * fights.length)];
        const initialEnemyHp = Math.max(0, fightData.hp ?? 0);
        const startEvent = fightData.eventStart ? findEventByIdOrTitle(fightData.eventStart) : null;
        setEnemyHitTrigger(0);
        combatCrewHullDamageAccumRef.current = 0;
        setCurrentFight(fightData);
        setCombatTurn(startEvent ? 0 : 1);
        setEnemyHp(initialEnemyHp);
        setCurrentEvent(null);
        setIsEventActive(false);
        setCombatEvent(startEvent || null);
        finalCurrentFight = fightData;
        finalCombatTurn = startEvent ? 0 : 1;
        finalEnemyHp = initialEnemyHp;
        newEventLog = [...newEventLog.slice(-5), `Бой начался: ${fightData.name}`].slice(-5);
        setEventLog(newEventLog);
      } else if (nodeType === NODE_TYPE.STORY) {
        const event = pickStoryEvent(currentNextDestId, shownSet, turn);
        if (event) {
          setCurrentEvent(event);
          setIsEventActive(true);
          newShownIds = [...shownEventIds, getEventKey(event)];
          setShownEventIds(newShownIds);
          if (isDestinationEvent(event)) {
            const nextId = (Number(event.id) || 0) + 1;
            newNextDestByDest = { ...nextDestByDestination, [destKey]: nextId };
            setNextDestByDestination(newNextDestByDest);
          }
        } else {
          setEventLog((prev) => [...prev.slice(-5), '[Ошибка: не удалось выбрать сюжетное событие]'].slice(-5));
        }
      } else if (nodeType === NODE_TYPE.RANDOM) {
        const event = pickRandomEvent(shownSet);
        if (event) {
          setCurrentEvent(event);
          setIsEventActive(true);
          newShownIds = [...shownEventIds, getEventKey(event)];
          setShownEventIds(newShownIds);
        } else {
          setEventLog((prev) => [...prev.slice(-5), '[Ошибка: не удалось выбрать событие]'].slice(-5));
        }
      } else if (nodeType === NODE_TYPE.TRADE) {
        const event = pickMarketEvent();
        if (event) {
          setCurrentEvent(event);
          setIsEventActive(true);
          newShownIds = [...shownEventIds, getEventKey(event)];
          setShownEventIds(newShownIds);
        } else {
          setEventLog((prev) => [...prev.slice(-5), 'Рынок пуст.'].slice(-5));
        }
      }
      setMapState(finalMapState);
    }

    saveGame({
      resources: tickResources,
      turn,
      eventLog: newEventLog,
      stormProgress: 0,
      playerVars,
      crew: finalCrew,
      mapState: serializeMapState(finalMapState),
      nextDestByDestination: newNextDestByDest,
      shownEventIds: newShownIds,
      currentFight: finalCurrentFight,
      combatTurn: finalCombatTurn,
      enemyHp: finalEnemyHp,
    });
  }, [mapState, gameCrew, resources, limits, turn, playerVars, events, fights, pickStoryEvent, pickRandomEvent, pickMarketEvent, pickCriticalEvent, isDestinationEvent, nextDestByDestination, shownEventIds, getEventKey, eventLog, currentFight, combatTurn, enemyHp, findEventByIdOrTitle, getCriticalResource, criticalPenalties]);

  const handleClusterTransition = useCallback(() => {
    if (isEventActive || isGameOver || isVictory || currentFight || !mapState) return;
    const exitId = mapState.nodes?.find((n) => n.isExit)?.id;
    if (exitId == null || mapState.currentNodeId !== exitId) return;

    const nextMapState = createInitialMapState();
    const targetNodeId = 0;

    const passiveApplied = applyPassiveCrewEffects(gameCrew, resources, limits);
    const nextCrew = passiveApplied.crew;
    const afterPassiveResources = passiveApplied.resources;
    const jumpCost = buildJumpSuppliesCost(nextCrew);
    let tickResources = applyDeltas(afterPassiveResources, jumpCost, limits);
    let criticalRes = getCriticalResource(tickResources, playerVars);
    const jumpPenalties = {};
    if (criticalRes !== 'supplies' && (tickResources.supplies ?? 0) <= 0 && playerVars.critical_supplies_0) {
      Object.assign(jumpPenalties, criticalPenalties?.supplies ?? {});
    }
    if (criticalRes !== 'energy' && (tickResources.energy ?? 0) <= 0 && playerVars.critical_energy_0) {
      Object.assign(jumpPenalties, criticalPenalties?.energy ?? {});
    }
    if (criticalRes !== 'morale' && (tickResources.morale ?? 0) <= 0 && playerVars.critical_morale_0) {
      Object.assign(jumpPenalties, criticalPenalties?.morale ?? {});
    }
    if (Object.keys(jumpPenalties).length > 0) {
      Object.assign(jumpCost, jumpPenalties);
      tickResources = applyDeltas(afterPassiveResources, jumpCost, limits);
      criticalRes = getCriticalResource(tickResources, playerVars);
    }
    const jumpHullDamage = (jumpCost.hull ?? 0) < 0 ? Math.abs(Math.round(jumpCost.hull)) : 0;
    const finalCrew = jumpHullDamage > 0 ? distributeHullDamageToCrew(nextCrew, jumpHullDamage) : nextCrew;

    setGameCrew(finalCrew);
    setResources(tickResources);
    setMapState(nextMapState);

    const calmDelta = formatDeltaForLog(jumpCost);
    let newEventLog = [...eventLog.slice(-5), `Переход в следующий кластер.${calmDelta}`].slice(-5);
    if (Object.keys(jumpPenalties).length > 0) {
      newEventLog = [...newEventLog.slice(-5), 'Штрафы за критические ресурсы применены.'].slice(-5);
    }
    setEventLog(newEventLog);

    const destKey = playerVars.dest === 'lighthouse' ? 'lighthouse' : playerVars.dest === 'demon' ? 'demon' : 'lighthouse';
    const currentNextDestId = nextDestByDestination[destKey] ?? 1;
    let newNextDestByDest = { ...nextDestByDestination };
    let newShownIds = shownEventIds;
    let finalMapState = nextMapState;
    let finalCurrentFight = currentFight;
    let finalCombatTurn = combatTurn;
    let finalEnemyHp = enemyHp;

    if (criticalRes) {
      const criticalEvent = pickCriticalEvent(events, criticalRes, tickResources, playerVars);
      if (criticalEvent) {
        setCurrentEvent(criticalEvent);
        setCurrentCriticalResource(criticalRes);
        setIsEventActive(true);
      }
    } else if (events.length > 0) {
      const nodeTypes = nextMapState.nodeTypes ?? {};
      let nodeType = nodeTypes[targetNodeId];
      if (nodeType == null) {
        nodeType = rollNodeType();
        finalMapState = { ...nextMapState, nodeTypes: { ...nodeTypes, [targetNodeId]: nodeType } };
      }

      const shownSet = new Set(shownEventIds);
      if (nodeType === NODE_TYPE.COMBAT && !fights?.length) nodeType = NODE_TYPE.RANDOM;

      if (nodeType === NODE_TYPE.COMBAT && fights?.length > 0) {
        const fightData = fights[Math.floor(Math.random() * fights.length)];
        const initialEnemyHp = Math.max(0, fightData.hp ?? 0);
        const startEvent = fightData.eventStart ? findEventByIdOrTitle(fightData.eventStart) : null;
        setEnemyHitTrigger(0);
        combatCrewHullDamageAccumRef.current = 0;
        setCurrentFight(fightData);
        setCombatTurn(startEvent ? 0 : 1);
        setEnemyHp(initialEnemyHp);
        setCurrentEvent(null);
        setIsEventActive(false);
        setCombatEvent(startEvent || null);
        finalCurrentFight = fightData;
        finalCombatTurn = startEvent ? 0 : 1;
        finalEnemyHp = initialEnemyHp;
        newEventLog = [...newEventLog.slice(-5), `Бой начался: ${fightData.name}`].slice(-5);
        setEventLog(newEventLog);
      } else if (nodeType === NODE_TYPE.STORY) {
        const event = pickStoryEvent(currentNextDestId, shownSet, turn);
        if (event) {
          setCurrentEvent(event);
          setIsEventActive(true);
          newShownIds = [...shownEventIds, getEventKey(event)];
          setShownEventIds(newShownIds);
          if (isDestinationEvent(event)) {
            const nextId = (Number(event.id) || 0) + 1;
            newNextDestByDest = { ...nextDestByDestination, [destKey]: nextId };
            setNextDestByDestination(newNextDestByDest);
          }
        } else {
          setEventLog((prev) => [...prev.slice(-5), '[Ошибка: не удалось выбрать сюжетное событие]'].slice(-5));
        }
      } else if (nodeType === NODE_TYPE.RANDOM) {
        const event = pickRandomEvent(shownSet);
        if (event) {
          setCurrentEvent(event);
          setIsEventActive(true);
          newShownIds = [...shownEventIds, getEventKey(event)];
          setShownEventIds(newShownIds);
        } else {
          setEventLog((prev) => [...prev.slice(-5), '[Ошибка: не удалось выбрать событие]'].slice(-5));
        }
      } else if (nodeType === NODE_TYPE.TRADE) {
        const event = pickMarketEvent();
        if (event) {
          setCurrentEvent(event);
          setIsEventActive(true);
          newShownIds = [...shownEventIds, getEventKey(event)];
          setShownEventIds(newShownIds);
        } else {
          setEventLog((prev) => [...prev.slice(-5), 'Рынок пуст.'].slice(-5));
        }
      }
      setMapState(finalMapState);
    }

    saveGame({
      resources: tickResources,
      turn,
      eventLog: newEventLog,
      stormProgress: 0,
      playerVars,
      crew: finalCrew,
      mapState: serializeMapState(finalMapState),
      nextDestByDestination: newNextDestByDest,
      shownEventIds: newShownIds,
      currentFight: finalCurrentFight,
      combatTurn: finalCombatTurn,
      enemyHp: finalEnemyHp,
    });
  }, [mapState, gameCrew, resources, limits, turn, playerVars, events, fights, pickStoryEvent, pickRandomEvent, pickMarketEvent, pickCriticalEvent, isDestinationEvent, nextDestByDestination, shownEventIds, getEventKey, eventLog, currentFight, combatTurn, enemyHp, findEventByIdOrTitle, getCriticalResource, criticalPenalties]);

  const handleChoice = useCallback(
    (choiceOrIndex) => {
      if (!currentEvent || isProcessing) return;
      const choice = typeof choiceOrIndex === 'number'
        ? currentEvent.choices[choiceOrIndex]
        : choiceOrIndex;
      if (!choice) return;

      setIsProcessing(true);

      let delta = choice.delta;
      let riskOutcome = null;
      let setVariable = choice.setVariable;
      if (choice.chance != null && choice.success != null && choice.failure != null) {
        riskOutcome = Math.random() < choice.chance ? 'success' : 'failure';
        delta = riskOutcome === 'success' ? choice.success : choice.failure;
        setVariable = riskOutcome === 'success' ? choice.successSetVariable : choice.failureSetVariable;
      }
      delta = delta ?? {};

      const crewMemberXpReward =
        choice.chance != null && choice.success != null && choice.failure != null
          ? (riskOutcome === 'success' ? choice.successCrewMemberXp : choice.failureCrewMemberXp)
          : choice.crewMemberXp;

      const resourceDelta = {};
      const statusFromDelta = {};
      Object.entries(delta).forEach(([k, v]) => {
        if (DELTA_KEYS.includes(k) && typeof v === 'number') resourceDelta[k] = v;
        else if (STATUS_VAR_KEYS.includes(k) && typeof v === 'string') statusFromDelta[k] = v;
      });
      setVariable = { ...statusFromDelta, ...setVariable };
      if (Object.keys(setVariable).length === 0) setVariable = null;

      const difficultyMultiplier = 1;
      const finalDelta = applyDifficultyToDeltas(resourceDelta, difficultyMultiplier);

      const hullDamage = (finalDelta.hull ?? 0) < 0 ? Math.abs(Math.round(finalDelta.hull)) : 0;
      const nextCrew = hullDamage > 0 ? distributeHullDamageToCrew(gameCrew, hullDamage) : gameCrew;

      let afterChoice = applyDeltas(resources, finalDelta, limits);
      const skillTurnDelta = getTurnStartSkillResourceDelta(gameCrew);
      if (Object.keys(skillTurnDelta).length > 0) {
        afterChoice = applyDeltas(afterChoice, skillTurnDelta, limits);
      }
      let finalCrew = nextCrew;
      const mergedPlayerVars = setVariable ? { ...playerVars, ...setVariable } : playerVars;

      if (currentCriticalResource) {
        const resVal = afterChoice[currentCriticalResource] ?? 0;
        const criticalVars = resVal <= 0 ? { [`critical_${currentCriticalResource}_0`]: true } : {};
        if (resVal <= 0) {
          const penalty = criticalPenalties?.[currentCriticalResource];
          if (penalty && Object.keys(penalty).length > 0) {
            afterChoice = applyDeltas(afterChoice, penalty, limits);
            const penaltyHull = (penalty.hull ?? 0) < 0 ? Math.abs(Math.round(penalty.hull)) : 0;
            if (penaltyHull > 0) finalCrew = distributeHullDamageToCrew(finalCrew, penaltyHull);
          }
        }
        setCurrentCriticalResource(null);
        if (Object.keys(criticalVars).length > 0) setPlayerVars((p) => ({ ...p, ...(setVariable || {}), ...criticalVars }));
        if (pendingFightEnd?.endEvent) setCombatEvent(pendingFightEnd.endEvent);
      } else {
        const nextCriticalRes = getCriticalResource(afterChoice, mergedPlayerVars);
        if (nextCriticalRes) {
          const criticalEvent = pickCriticalEvent(events, nextCriticalRes, afterChoice, mergedPlayerVars);
          if (criticalEvent) {
            setResources(afterChoice);
            const xpInd =
              crewMemberXpReward && typeof crewMemberXpReward === 'object' && Object.keys(crewMemberXpReward).length > 0
                ? applyCrewMemberXpBySlug(nextCrew, crewMemberXpReward, crew)
                : { crew: nextCrew, logLines: [] };
            setGameCrew(xpInd.crew);
            setCurrentEvent(criticalEvent);
            setCurrentCriticalResource(nextCriticalRes);
            if (setVariable) setPlayerVars(mergedPlayerVars);
            setIsProcessing(false);
            const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
            const deltaStr = formatDeltaForLog(finalDelta);
            setEventLog((prev) =>
              [...prev.slice(-5), `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`, ...xpInd.logLines].slice(-5)
            );
            return;
          }
        }
      }

      const newPlayerVars = setVariable ? mergedPlayerVars : playerVars;
      if (setVariable) setPlayerVars(newPlayerVars);

      const fightId = setVariable?.fight;
      if (fightId != null) {
        const idStr = String(fightId).trim().toLowerCase().replace(/\s+/g, ' ');
        let fightData = fights?.length > 0
          ? fights.find((f) => {
              const fid = String(f.id).trim().toLowerCase().replace(/\s+/g, ' ');
              return fid === idStr || fid.includes(idStr) || idStr.includes(fid);
            })
          : null;
        // Fallback: fightId "1" → первый бой в таблице (для events.json)
        if (!fightData && fights?.length > 0 && String(fightId).trim() === '1') {
          fightData = fights[0];
        }
        if (fightData) {
          const enemyDamageFromChoice = riskOutcome != null
            ? (riskOutcome === 'success' ? choice.successEnemyDamage : choice.failureEnemyDamage)
            : choice.enemyDamage;
          const initialEnemyHp = Math.max(0, fightData.hp - (enemyDamageFromChoice ?? 0));
          setEnemyHitTrigger(0);
          if ((enemyDamageFromChoice ?? 0) > 0) setEnemyHitTrigger((t) => t + 1);
          const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
          const deltaStr = formatDeltaForLog(finalDelta);
          setResources(afterChoice);
          const xpBeforeFight =
            crewMemberXpReward && typeof crewMemberXpReward === 'object' && Object.keys(crewMemberXpReward).length > 0
              ? applyCrewMemberXpBySlug(finalCrew, crewMemberXpReward, crew)
              : { crew: finalCrew, logLines: [] };
          setGameCrew(xpBeforeFight.crew);
          setCurrentEvent(null);
          setIsEventActive(false);
          setIsProcessing(false);
          combatCrewHullDamageAccumRef.current = 0;
          setCurrentFight(fightData);
          const startEvent = fightData.eventStart ? findEventByIdOrTitle(fightData.eventStart) : null;
          setCombatTurn(startEvent ? 0 : 1);
          setEnemyHp(initialEnemyHp);
          setCombatEvent(startEvent || null);
          const fightStartLog = [
            ...eventLog.slice(-5),
            `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`,
            ...xpBeforeFight.logLines,
            `Бой начался: ${fightData.name}`,
          ];
          if (setVariable?.demon === 'захвачен') fightStartLog.push('Демон захвачен.');
          if (setVariable?.demon === 'подчинен') fightStartLog.push('Демон подчинён.');
          if (setVariable?.engine === 'работает') fightStartLog.push('Двигатель: работает.');
          const newEventLog = fightStartLog.slice(-5);
          setEventLog(newEventLog);
          saveGame({
            resources: afterChoice,
            turn,
            eventLog: newEventLog,
            stormProgress: 0,
            playerVars: newPlayerVars,
            crew: xpBeforeFight.crew,
            mapState: mapState ? serializeMapState(mapState) : null,
            nextDestByDestination,
            shownEventIds,
            currentFight: fightData,
            combatTurn: 1,
            enemyHp: initialEnemyHp,
          });
          return;
        }
        console.warn('[Combat] fightId=', JSON.stringify(fightId), 'setVariable=', setVariable, 'fights=', fights?.map((f) => f.id) ?? 'null', 'fightsCount=', fights?.length ?? 0);
      }

      let crewForEvent = finalCrew;
      let xpRewardLogs = [];
      if (crewMemberXpReward && typeof crewMemberXpReward === 'object' && Object.keys(crewMemberXpReward).length > 0) {
        const ind = applyCrewMemberXpBySlug(finalCrew, crewMemberXpReward, crew);
        crewForEvent = ind.crew;
        xpRewardLogs = [...ind.logLines];
      }
      if ((afterChoice.hull ?? 0) > 0) {
        const xpResult = applyTeamXpReward(crewForEvent, crew);
        crewForEvent = xpResult.crew;
        xpRewardLogs = [...xpRewardLogs, ...xpResult.logLines];
      }

      setResources(afterChoice);
      setGameCrew(crewForEvent);

      const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
      const deltaStr = formatDeltaForLog(finalDelta);
      const logEntries = [
        ...eventLog.slice(-5),
        `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`,
        ...xpRewardLogs,
      ];
      if (setVariable?.demon === 'захвачен') logEntries.push('Демон захвачен.');
      if (setVariable?.demon === 'подчинен') logEntries.push('Демон подчинён.');
      if (setVariable?.engine === 'работает') logEntries.push('Двигатель: работает.');
      setEventLog(logEntries.slice(-5));

      if (!pendingFightEnd) setTurn((t) => t + 1);
      setCurrentEvent(null);
      setIsEventActive(false);
      setIsProcessing(false);

      const isDead = (afterChoice.hull ?? 0) <= 0;
      if (!isDead) {
        const newTurn = turn + 1;
        const newEventLog = logEntries.slice(-5);
        saveGame({
          resources: afterChoice,
          turn: newTurn,
          eventLog: newEventLog,
          stormProgress: 0,
          playerVars: newPlayerVars,
          crew: crewForEvent,
          mapState: mapState ? serializeMapState(mapState) : null,
          nextDestByDestination,
          shownEventIds,
          currentFight,
          combatTurn,
          enemyHp,
        });
      }
    },
    [currentEvent, isProcessing, limits, resources, turn, eventLog, playerVars, gameCrew, mapState, nextDestByDestination, shownEventIds, fights, currentFight, combatTurn, enemyHp, findEventByIdOrTitle, currentCriticalResource, criticalPenalties, getCriticalResource, pickCriticalEvent, events, pendingFightEnd, crew]
  );

  const finishCombat = useCallback((win) => {
    if (!win) {
      combatCrewHullDamageAccumRef.current = 0;
    }
    setPlayerVars((prev) => ({ ...prev, fight: win ? 'win' : 'lose' }));
    setCurrentFight(null);
   setEnemyHp(0);
    setEnemyHitTrigger(0);
    setPendingFightEnd(null);
    setPendingCombatAction(null);
    setCombatEvent(null);
    if (!win) {
      setEventLog((prev) => [...prev.slice(-5), 'Корабль уничтожен. Поражение.'].slice(-5));
    }
  }, []);

  const runCombatTurn = useCallback(
    (playerDamageDealt, playerDamageTaken, actionName, customLogMessage) => {
      if (!currentFight) return;
      if (actionName === 'Таран') setRamTrigger((t) => t + 1);
      if (playerDamageTaken > 0) setPlayerHitTrigger((t) => t + 1);
      if (playerDamageDealt > 0) setEnemyHitTrigger((t) => t + 1);
      const newEnemyHp = Math.max(0, enemyHp - playerDamageDealt);
      const hullDamage = Math.min(playerDamageTaken, resources.hull ?? 0);
      combatCrewHullDamageAccumRef.current += hullDamage;
      let newHull = Math.max(0, (resources.hull ?? 0) - playerDamageTaken);
      const nextCrew = gameCrew;
      let afterCombatResources = { ...resources, hull: newHull };
      if (actionName === 'Атака') afterCombatResources = applyDeltas(afterCombatResources, { energy: -3 }, limits);
      const finalHull = afterCombatResources.hull ?? 0;
      setEnemyHp(newEnemyHp);
      setResources(afterCombatResources);
      const logEntry = customLogMessage ?? `Ход ${combatTurn}: ${actionName}. Вы нанесли ${playerDamageDealt} урона, получили ${playerDamageTaken} урона.`;
      let newEventLog = [...eventLog.slice(-5), logEntry].slice(-5);
      setEventLog(newEventLog);
      const combatEnded = newEnemyHp <= 0 || finalHull <= 0;
      if (combatEnded) {
        const endEventRef = currentFight.endFightEvent;
        const endEvent = findEventByIdOrTitle(endEventRef);
        const won = newEnemyHp <= 0 && finalHull > 0;
        let crewAfterCombat = nextCrew;
        if (won) {
          const crewAfterHull = applyAccumulatedCombatHullDamageToCrew(nextCrew, combatCrewHullDamageAccumRef);
          const r = applyTeamXpReward(crewAfterHull, crew);
          crewAfterCombat = r.crew;
          setGameCrew(r.crew);
          newEventLog = [...eventLog.slice(-5), logEntry, 'Враг повержен! Победа!', ...r.logLines].slice(-5);
          setEventLog(newEventLog);
        } else {
          combatCrewHullDamageAccumRef.current = 0;
        }
        setPendingFightEnd({ win: won, endEvent });
        const endPlayerVars = { ...playerVars, fight: won ? 'win' : 'lose' };
        if (endEvent) {
          setPlayerVars((prev) => ({ ...prev, fight: won ? 'win' : 'lose' }));
          setCombatEvent(endEvent);
        } else {
          finishCombat(won);
        }
        saveGame({
          resources: afterCombatResources,
          turn,
          eventLog: newEventLog,
          stormProgress: 0,
          playerVars: endPlayerVars,
          crew: crewAfterCombat,
          mapState: mapState ? serializeMapState(mapState) : null,
          nextDestByDestination,
          shownEventIds,
          currentFight: endEvent ? currentFight : null,
          combatTurn: endEvent ? combatTurn : combatTurn,
          enemyHp: 0,
        });
        return;
      }

      const nextTurn = combatTurn + 1;
      setCombatTurn(nextTurn);

      saveGame({
        resources: afterCombatResources,
        turn,
        eventLog: newEventLog,
        stormProgress: 0,
        playerVars,
        crew: nextCrew,
        mapState: mapState ? serializeMapState(mapState) : null,
        nextDestByDestination,
        shownEventIds,
        currentFight,
        combatTurn: nextTurn,
        enemyHp: newEnemyHp,
      });
    },
    [currentFight, enemyHp, resources, combatTurn, eventLog, mapState, playerVars, turn, nextDestByDestination, shownEventIds, findEventByIdOrTitle, finishCombat, gameCrew, limits, crew]
  );

  const handleCombatAction = useCallback(
    (action) => {
      if (!currentFight || isProcessing) return;
      if (action === 'attack' && (resources.energy ?? 0) < 3) {
        setEventLog((prev) => [...prev.slice(-5), 'Недостаточно энергии для атаки (нужно 3).'].slice(-5));
        return;
      }
      if (action === 'flee') {
        if (!isDemonSubordinate(playerVars.demon)) return;
        if ((resources.energy ?? 0) < 30 || (resources.supplies ?? 0) < 30) {
          setEventLog((prev) => [...prev.slice(-5), 'Недостаточно энергии или припасов для побега (нужно 30 энергии и 30 припасов).'].slice(-5));
          return;
        }
      }
      setIsProcessing(true);
      const enemyDamage = rollNd6(currentFight.attackD6);
      let playerDamageDealt = 0;
      let playerDamageTaken = enemyDamage;
      let actionName = '';
      let customLogMessage = null;

      if (action === 'attack') {
        playerDamageDealt = rollNd6(2) + getCombatAttackBonus(gameCrew);
        actionName = 'Атака';
      } else if (action === 'ram') {
        playerDamageDealt = 10;
        playerDamageTaken = enemyDamage + 5;
        actionName = 'Таран';
        customLogMessage = `Энергия на нуле! Идем на таран! Вы нанесли 10 урона, получили ${enemyDamage} урона от залпа врага и 5 урона за столкновение.`;
      } else if (action === 'dodge') {
        const dodgeRoll = Math.random();
        if (dodgeRoll < 0.5) playerDamageTaken = 0;
        else playerDamageTaken = Math.floor(enemyDamage / 2);
        actionName = 'Уклонение';
      } else if (action === 'flee') {
        const afterFlee = applyDeltas(resources, FLEE_COST, limits);
        const xpResult = applyTeamXpReward(gameCrew, crew);
        const deltaStr = formatDeltaForLog(FLEE_COST);
        const newEventLog = [
          ...eventLog.slice(-5),
          `Ход ${combatTurn}: Сбежать. Вы сбежали с поля боя.${deltaStr}`,
          ...xpResult.logLines,
        ].slice(-5);
        combatCrewHullDamageAccumRef.current = 0;
        setResources(afterFlee);
        setGameCrew(xpResult.crew);
        setCurrentFight(null);
        setEnemyHp(0);
        setPlayerVars((prev) => ({ ...prev, fight: 'win' }));
        setEventLog(newEventLog);
        saveGame({
          resources: afterFlee,
          turn,
          eventLog: newEventLog,
          stormProgress: 0,
          playerVars: { ...playerVars, fight: 'win' },
          crew: xpResult.crew,
          mapState: mapState ? serializeMapState(mapState) : null,
          nextDestByDestination,
          shownEventIds,
          currentFight: null,
          combatTurn: 0,
          enemyHp: 0,
        });
        setIsProcessing(false);
        return;
      }

      // Сначала проверяем ивент (50%): если есть — показываем, урон применится после выбора
      const turnIndex = Math.min(combatTurn - 1, 4);
      const turnEventRef = currentFight.eventTurns?.[turnIndex];
      if (Math.random() < 0.5 && turnEventRef) {
        const ev = findEventByIdOrTitle(turnEventRef);
        if (ev) {
          setPendingCombatAction({ playerDamageDealt, playerDamageTaken, actionName, customLogMessage });
          setCombatEvent(ev);
          setIsProcessing(false);
          return;
        }
      }

      runCombatTurn(playerDamageDealt, playerDamageTaken, actionName, customLogMessage);
      setIsProcessing(false);
    },
    [
      currentFight,
      combatTurn,
      isProcessing,
      playerVars.demon,
      playerVars,
      resources,
      limits,
      eventLog,
      turn,
      gameCrew,
      mapState,
      nextDestByDestination,
      shownEventIds,
      runCombatTurn,
      findEventByIdOrTitle,
      crew,
    ]
  );

  const handleCombatEventChoice = useCallback(
    (choice) => {
      if (!combatEvent) return;
      let delta = choice?.delta ?? {};
      let setVariable = choice?.setVariable ?? {};
      let choiceEnemyDamage = choice?.enemyDamage ?? 0;
      let riskOutcome = null;
      if (choice?.chance != null && choice?.success != null && choice?.failure != null) {
        riskOutcome = Math.random() < choice.chance ? 'success' : 'failure';
        delta = riskOutcome === 'success' ? choice.success : choice.failure;
        setVariable = (riskOutcome === 'success' ? choice.successSetVariable : choice.failureSetVariable) ?? {};
        choiceEnemyDamage = riskOutcome === 'success' ? (choice.successEnemyDamage ?? 0) : (choice.failureEnemyDamage ?? 0);
      }
      const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
      const deltaStr = formatDeltaForLog(delta, choiceEnemyDamage > 0 ? { enemy_damage: choiceEnemyDamage } : {});
      const choiceHullDamage = (delta.hull ?? 0) < 0 ? Math.abs(Math.round(delta.hull)) : 0;
      combatCrewHullDamageAccumRef.current += choiceHullDamage;
      const nextCrew = gameCrew;
      let afterResources = applyDeltas(resources, delta, limits);
      const mergedCombatPlayerVars = Object.keys(setVariable).length > 0 ? { ...playerVars, ...setVariable } : playerVars;
      if (Object.keys(setVariable).length > 0) setPlayerVars(mergedCombatPlayerVars);

      const combatLogEntries = [...eventLog.slice(-5), `Бой: ${combatEvent.title} → "${choice?.text || 'Продолжить'}"${riskSuffix}${deltaStr}`];
      if (setVariable?.demon === 'захвачен') combatLogEntries.push('Демон захвачен.');
      if (setVariable?.demon === 'подчинен') combatLogEntries.push('Демон подчинён.');
      if (setVariable?.engine === 'работает') combatLogEntries.push('Двигатель: работает.');
      setEventLog(combatLogEntries.slice(-5));
      setCombatEvent(null);

      const pending = pendingCombatAction;
      setPendingCombatAction(null);

      if (pending) {
        const { playerDamageDealt, playerDamageTaken, actionName, customLogMessage } = pending;
        if (actionName === 'Таран') setRamTrigger((t) => t + 1);
        if (playerDamageTaken > 0 || choiceHullDamage > 0) setPlayerHitTrigger((t) => t + 1);
        if (playerDamageDealt > 0 || choiceEnemyDamage > 0) setEnemyHitTrigger((t) => t + 1);

        const combatHullDamage = Math.min(playerDamageTaken, afterResources.hull ?? 0);
        combatCrewHullDamageAccumRef.current += combatHullDamage;
        const newHull = Math.max(0, (afterResources.hull ?? 0) - playerDamageTaken);
        const totalEnemyDamage = playerDamageDealt + choiceEnemyDamage;
        const newEnemyHp = Math.max(0, (enemyHp ?? 0) - totalEnemyDamage);

        let finalResources = { ...afterResources, hull: newHull };
        if (actionName === 'Атака') finalResources = applyDeltas(finalResources, { energy: -3 }, limits);
        const pendingCriticalRes = getCriticalResource(finalResources, mergedCombatPlayerVars);
        if (pendingCriticalRes) {
          const criticalEvent = pickCriticalEvent(events, pendingCriticalRes, finalResources, mergedCombatPlayerVars);
          if (criticalEvent) {
            setResources(finalResources);
            const endedWithResult = newEnemyHp <= 0 || newHull <= 0;
            const wonCritical = newEnemyHp <= 0 && newHull > 0;
            let crewForCritical = nextCrew;
            const extraLog = [];
            if (endedWithResult) {
              if (wonCritical) {
                const crewAfterHull = applyAccumulatedCombatHullDamageToCrew(gameCrew, combatCrewHullDamageAccumRef);
                const r = applyTeamXpReward(crewAfterHull, crew);
                crewForCritical = r.crew;
                extraLog.push('Враг повержен! Победа!', ...r.logLines);
              } else {
                combatCrewHullDamageAccumRef.current = 0;
              }
            }
            setGameCrew(crewForCritical);
            setEnemyHp(newEnemyHp);
            setCurrentEvent(criticalEvent);
            setCurrentCriticalResource(pendingCriticalRes);
            const pendingLogEntry = customLogMessage ?? `Ход ${combatTurn}: ${actionName}. Вы нанесли ${playerDamageDealt} урона, получили ${playerDamageTaken} урона.`;
            setEventLog((prev) => [...prev.slice(-5), pendingLogEntry, ...extraLog].slice(-5));
            if (newEnemyHp <= 0 || newHull <= 0) {
              const won = newEnemyHp <= 0 && newHull > 0;
              setPendingFightEnd({ win, endEvent: won ? findEventByIdOrTitle(currentFight?.endFightEvent) : null });
            } else {
              setCombatTurn(combatTurn + 1);
            }
            saveGame({
              resources: finalResources,
              turn,
              eventLog: [...combatLogEntries, pendingLogEntry].slice(-5),
              stormProgress: 0,
              playerVars: { ...mergedCombatPlayerVars, fight: (newEnemyHp <= 0 && newHull > 0) ? 'win' : (newHull <= 0 ? 'lose' : undefined) },
              crew: crewForCritical,
              mapState: mapState ? serializeMapState(mapState) : null,
              nextDestByDestination,
              shownEventIds,
              currentFight: currentFight,
              combatTurn: newEnemyHp <= 0 || newHull <= 0 ? combatTurn : combatTurn + 1,
              enemyHp: newEnemyHp,
            });
            return;
          }
        }
        setResources(finalResources);
        setGameCrew(nextCrew);
        setEnemyHp(newEnemyHp);
        const mainLogEntry = customLogMessage ?? `Ход ${combatTurn}: ${actionName}. Вы нанесли ${playerDamageDealt} урона, получили ${playerDamageTaken} урона.`;

        const combatEnded = newEnemyHp <= 0 || newHull <= 0;
        if (combatEnded) {
          const endEventRef = currentFight?.endFightEvent;
          const endEvent = findEventByIdOrTitle(endEventRef);
          const won = newEnemyHp <= 0 && newHull > 0;
          let crewAfter = nextCrew;
          if (won) {
            const crewAfterHull = applyAccumulatedCombatHullDamageToCrew(gameCrew, combatCrewHullDamageAccumRef);
            const r = applyTeamXpReward(crewAfterHull, crew);
            crewAfter = r.crew;
            setGameCrew(r.crew);
            setEventLog((prev) => [...prev.slice(-5), mainLogEntry, 'Враг повержен! Победа!', ...r.logLines].slice(-5));
          } else {
            combatCrewHullDamageAccumRef.current = 0;
            setEventLog((prev) => [...prev.slice(-5), mainLogEntry].slice(-5));
          }
          setPendingFightEnd({ win: won, endEvent });
          if (endEvent) {
            setPlayerVars((prev) => ({ ...prev, fight: won ? 'win' : 'lose' }));
            setCombatEvent(endEvent);
          } else {
            finishCombat(won);
          }
          saveGame({
            resources: finalResources,
            turn,
            eventLog: [...eventLog.slice(-5), `Бой: ${combatEvent.title} → "${choice?.text || 'Продолжить'}"${riskSuffix}${deltaStr}`, mainLogEntry].slice(-5),
            stormProgress: 0,
            playerVars: { ...playerVars, ...setVariable, fight: won ? 'win' : 'lose' },
            crew: crewAfter,
            mapState: mapState ? serializeMapState(mapState) : null,
            nextDestByDestination,
            shownEventIds,
            currentFight: endEvent ? currentFight : null,
            combatTurn: combatTurn,
            enemyHp: 0,
          });
        } else {
          setEventLog((prev) => [...prev.slice(-5), mainLogEntry].slice(-5));
          const nextTurn = combatTurn + 1;
          setCombatTurn(nextTurn);
          saveGame({
            resources: finalResources,
            turn,
            eventLog: [...eventLog.slice(-5), `Бой: ${combatEvent.title} → "${choice?.text || 'Продолжить'}"${riskSuffix}${deltaStr}`, mainLogEntry].slice(-5),
            stormProgress: 0,
            playerVars: { ...playerVars, ...setVariable },
            crew: nextCrew,
            mapState: mapState ? serializeMapState(mapState) : null,
            nextDestByDestination,
            shownEventIds,
            currentFight,
            combatTurn: nextTurn,
            enemyHp: newEnemyHp,
          });
        }
      } else {
        const combatCriticalRes = getCriticalResource(afterResources, mergedCombatPlayerVars);
        if (combatCriticalRes) {
          const criticalEvent = pickCriticalEvent(events, combatCriticalRes, afterResources, mergedCombatPlayerVars);
          if (criticalEvent) {
            setResources(afterResources);
            setCurrentEvent(criticalEvent);
            setCurrentCriticalResource(combatCriticalRes);
            setEventLog(combatLogEntries.slice(-5));
            saveGame({
              resources: afterResources,
              turn,
              eventLog: combatLogEntries.slice(-5),
              stormProgress: 0,
              playerVars: mergedCombatPlayerVars,
              crew: nextCrew,
              mapState: mapState ? serializeMapState(mapState) : null,
              nextDestByDestination,
              shownEventIds,
              currentFight,
              combatTurn,
              enemyHp: Math.max(0, (enemyHp ?? 0) - choiceEnemyDamage),
            });
            return;
          }
        }
        if (choiceHullDamage > 0) setPlayerHitTrigger((t) => t + 1);
        if (choiceEnemyDamage > 0) setEnemyHitTrigger((t) => t + 1);
        setResources(afterResources);
        const newEnemyHp = Math.max(0, (enemyHp ?? 0) - choiceEnemyDamage);
        setEnemyHp(newEnemyHp);
        if (combatTurn === 0) {
          setCombatTurn(1);
          saveGame({
            resources: afterResources,
            turn,
            eventLog: [...eventLog.slice(-5), `Бой: ${combatEvent.title} → "${choice?.text || 'Продолжить'}"${riskSuffix}${deltaStr}`].slice(-5),
            stormProgress: 0,
            playerVars: { ...playerVars, ...setVariable },
            crew: nextCrew,
            mapState: mapState ? serializeMapState(mapState) : null,
            nextDestByDestination,
            shownEventIds,
            currentFight,
            combatTurn: 1,
            enemyHp: newEnemyHp,
          });
        } else if (pendingFightEnd) {
          finishCombat(pendingFightEnd.win);
        } else if ((afterResources.hull ?? 0) <= 0) {
          finishCombat(false);
        } else if (newEnemyHp <= 0) {
          const endEventRef = currentFight?.endFightEvent;
          const endEvent = findEventByIdOrTitle(endEventRef);
          const crewAfterWin = applyAccumulatedCombatHullDamageToCrew(gameCrew, combatCrewHullDamageAccumRef);
          const r = applyTeamXpReward(crewAfterWin, crew);
          setGameCrew(r.crew);
          setEventLog((prev) => [...prev.slice(-5), 'Враг повержен! Победа!', ...r.logLines].slice(-5));
          setPendingFightEnd({ win: true, endEvent });
          if (endEvent) {
            setPlayerVars((prev) => ({ ...prev, fight: 'win' }));
            setCombatEvent(endEvent);
          } else {
            finishCombat(true);
          }
        }
      }
    },
    [combatEvent, pendingFightEnd, pendingCombatAction, limits, finishCombat, gameCrew, resources, enemyHp, combatTurn, eventLog, currentFight, findEventByIdOrTitle, mapState, playerVars, turn, nextDestByDestination, shownEventIds, crew, events]
  );

  const handleIntroNext = useCallback(
    (choice) => {
      if (choice?.setVariable) {
        setPlayerVars((prev) => ({ ...prev, ...choice.setVariable }));
        if (choice.setVariable.demon === 'захвачен') setEventLog((prev) => [...prev.slice(-5), 'Демон захвачен.'].slice(-5));
        if (choice.setVariable.demon === 'подчинен') setEventLog((prev) => [...prev.slice(-5), 'Демон подчинён.'].slice(-5));
        if (choice.setVariable.engine === 'работает') setEventLog((prev) => [...prev.slice(-5), 'Двигатель: работает.'].slice(-5));
      }
      if (choice?.delta && typeof choice.delta === 'object' && Object.keys(choice.delta).length > 0) {
        setResources((prev) => applyDeltas(prev, choice.delta, limits));
      }
      if (choice?.crewMemberXp && typeof choice.crewMemberXp === 'object' && Object.keys(choice.crewMemberXp).length > 0) {
        setGameCrew((prev) => applyCrewMemberXpBySlug(prev, choice.crewMemberXp, crew).crew);
      }
      const nextStep = introStep + 1;
      setIntroStep(nextStep);
    },
    [limits, introStep, crew]
  );

  const handleNewGame = useCallback(() => {
    clearSave();
    setPlayerHitTrigger(0);
    setEnemyHitTrigger(0);
    setResources(withFixedShipStats(shipStats ?? DEFAULT_SHIP_STATS));
    const preparedCrew = rollInitialCrewDamage(pickCrewNames(crew));
    setGameCrew(preparedCrew);
    setPendingCrewInit(preparedCrew.length === 0);
    setMapState(createInitialMapState());
    setTurn(0);
    setEventLog([]);
    setCurrentEvent(null);
    setIsEventActive(false);
    setIsProcessing(false);
    setIntroStep(0);
    setPlayerVars(INITIAL_PLAYER_VARS);
    setNextDestByDestination({ lighthouse: 1, demon: 1 });
    setShownEventIds([]);
    setCurrentFight(null);
    setCombatTurn(0);
    setEnemyHp(0);
    setCombatEvent(null);
    setPendingFightEnd(null);
    setShowMenu(false);
    audioRef.current?.play().catch(() => {});
  }, [shipStats, crew]);

  const handleContinue = useCallback(() => {
    const saved = loadGame();
    if (!saved) return;
    setPlayerHitTrigger(0);
    setEnemyHitTrigger(0);
    setResources(withFixedShipStats(migrateResources(saved.resources) ?? shipStats ?? DEFAULT_SHIP_STATS));
    setGameCrew((saved.crew ?? []).map(normalizeCrewMember));
    setPendingCrewInit(false);
    setMapState(deserializeMapState(saved.mapState) ?? createInitialMapState());
    setTurn(saved.turn ?? 0);
    setEventLog((saved.eventLog ?? []).slice(-5));
    setCurrentEvent(null);
    setIsEventActive(false);
    setIsProcessing(false);
    setPlayerVars({ ...INITIAL_PLAYER_VARS, ...(saved.playerVars && typeof saved.playerVars === 'object' ? saved.playerVars : {}) });
    setNextDestByDestination(
      saved.nextDestByDestination ?? (saved.nextDestinationEventId != null ? { lighthouse: saved.nextDestinationEventId, demon: saved.nextDestinationEventId } : { lighthouse: 1, demon: 1 })
    );
    setShownEventIds(saved.shownEventIds ?? []);
    combatCrewHullDamageAccumRef.current = 0;
    setCurrentFight(saved.currentFight ?? null);
    setCombatTurn(saved.combatTurn ?? 0);
    setEnemyHp(saved.enemyHp ?? 0);
    setCombatEvent(null);
    setPendingFightEnd(null);
    setIntroStep(introSlides.length);
    setShowMenu(false);
    audioRef.current?.play().catch(() => {});
  }, [introSlides.length, shipStats]);

  const handleRestart = useCallback(() => {
    if (isVictory) clearSave();
    setResources(withFixedShipStats(shipStats ?? DEFAULT_SHIP_STATS));
    setGameCrew([]);
    setPendingCrewInit(false);
    setMapState(createInitialMapState());
    setTurn(0);
    setEventLog([]);
    setCurrentEvent(null);
    setIsEventActive(false);
    setIsProcessing(false);
    setIntroStep(0);
    setPlayerVars(INITIAL_PLAYER_VARS);
    setNextDestByDestination({ lighthouse: 1, demon: 1 });
    setShownEventIds([]);
    setCurrentFight(null);
    setCombatTurn(0);
    setEnemyHp(0);
    setCombatEvent(null);
    setPendingFightEnd(null);
    setShowMenu(true);
  }, [isVictory, shipStats]);

  if (showMenu) {
    if (loading) {
      return (
        <>
          <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" muted={!musicEnabled} />
          <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center justify-center p-8">
            <h1 className="text-2xl font-bold text-amber-500/90 tracking-wider mb-6">LOST SHIP</h1>
            <p className="text-zinc-500 text-sm mb-4">Загрузка...</p>
            <div className="w-64 h-2 bg-zinc-800 rounded overflow-hidden border border-zinc-600">
              <div className="h-full bg-amber-500/80 animate-loading-progress rounded" />
            </div>
          </div>
        </>
      );
    }
    return (
      <>
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" muted={!musicEnabled} />
        <StartMenu
          onNewGame={handleNewGame}
          onContinue={handleContinue}
          hasSave={hasSave()}
          musicEnabled={musicEnabled}
          onMusicToggle={handleMusicToggle}
        />
      </>
    );
  }

  if (introStep < introSlides.length) {
    return (
      <>
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" muted={!musicEnabled} />
        <div className="min-h-screen bg-zinc-950">
        <IntroPopup
          slide={introSlides[introStep]}
          onNext={handleIntroNext}
        />
      </div>
      </>
    );
  }

  if (isGameOver) {
    return (
      <>
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" muted={!musicEnabled} />
        <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center justify-center p-8">
        <h2 className="text-2xl font-bold text-red-500 mb-4">Корабль потерян в пустоте</h2>
        <p className="text-zinc-400 mb-6 text-center">
          Прочность: {resources.hull}% | Мораль: {resources.morale}%
        </p>
        <button
          type="button"
          onClick={handleRestart}
          className="px-8 py-3 rounded border-2 border-amber-600 bg-amber-900/50 hover:bg-amber-800/50 text-amber-400 font-semibold transition-colors"
        >
          НАЧАТЬ ЗАНОВО
        </button>
      </div>
      </>
    );
  }

  if (isVictory) {
    return (
      <>
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" muted={!musicEnabled} />
        <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center justify-center p-8">
        <h2 className="text-2xl font-bold text-emerald-500 mb-4">Победа!</h2>
        <p className="text-zinc-400 mb-6 text-center">
          Продолжение следует
        </p>
        <button
          type="button"
          onClick={handleRestart}
          className="px-8 py-3 rounded border-2 border-emerald-600 bg-emerald-900/50 hover:bg-emerald-800/50 text-emerald-400 font-semibold transition-colors"
        >
          ИГРАТЬ СНОВА
        </button>
      </div>
      </>
    );
  }

  return (
    <>
      <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" muted={!musicEnabled} />
      <div className={`min-h-screen bg-zinc-950 text-zinc-300 font-mono p-4 ${ramShake ? 'animate-screen-shake-strong' : screenShake ? 'animate-screen-shake' : ''}`}>
      <header className="mb-2 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              saveGame({ resources, turn, eventLog, stormProgress: 0, playerVars, crew: gameCrew, mapState: mapState ? serializeMapState(mapState) : null, nextDestByDestination, shownEventIds, currentFight, combatTurn, enemyHp });
              setPlayerHitTrigger(0);
              setEnemyHitTrigger(0);
              setShowMenu(true);
            }}
            className="p-1.5 rounded border-2 border-zinc-600 bg-zinc-800/50 hover:border-amber-500 hover:bg-zinc-700/50 transition-colors"
            aria-label="Меню"
          >
            <span className="flex flex-col gap-0.5">
              <span className="block w-4 h-0.5 bg-zinc-400 rounded" />
              <span className="block w-4 h-0.5 bg-zinc-400 rounded" />
              <span className="block w-4 h-0.5 bg-zinc-400 rounded" />
            </span>
          </button>
          <p className="text-xs text-zinc-500">Ход: {turn}</p>
        </div>
        {fromSheet && (
          <span className="text-xs text-emerald-500/80">Таблица подключена</span>
        )}
      </header>

      <div className="mb-2 terminal-panel p-3">
        <div className="text-cyan-500/90 text-sm font-semibold">
          Курс на {playerVars.dest === 'demon' ? 'поиски демона' : playerVars.dest === 'market' ? 'Мир-Рынок' : playerVars.dest === 'lighthouse' ? 'Планарный Маяк' : '—'}
        </div>
      </div>

      <ShipDisplay
        isWarping={isWarping}
        onWarpEnd={handleWarpEnd}
        enemy={currentFight ? { icon: currentFight.icon, name: currentFight.name, hp: enemyHp, maxHp: currentFight.hp } : null}
        playerHitTrigger={playerHitTrigger}
        enemyHitTrigger={enemyHitTrigger}
        ramTrigger={ramTrigger}
      />

      <InfoPanel playerVars={playerVars} resources={resources} />

      <EventPopup
        event={currentEvent || combatEvent}
        onChoice={combatEvent ? handleCombatEventChoice : handleChoice}
        disabled={isProcessing}
        playerVars={playerVars}
        resources={resources}
      />

      <EventLog entries={eventLog} />

      <div className="mb-2 flex justify-between gap-4">
        {currentFight ? (
          <>
            <button
              type="button"
              disabled={
                isProcessing ||
                !!combatEvent ||
                !isDemonSubordinate(playerVars.demon) ||
                (resources.energy ?? 0) < 30 ||
                (resources.supplies ?? 0) < 30
              }
              onClick={() => handleCombatAction('flee')}
              className="flex-1 py-3 rounded border-2 border-zinc-600 bg-zinc-800/50 font-mono text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex flex-col gap-0.5 leading-tight items-center justify-center"
            >
              <span>Сбежать</span>
              <span className="text-[10px] sm:text-xs text-zinc-500 font-normal">{FLEE_BUTTON_COST_TEXT}</span>
            </button>
            <button
              type="button"
              disabled={isProcessing || !!combatEvent}
              onClick={() => handleCombatAction('dodge')}
              className="flex-1 py-3 rounded border-2 border-zinc-600 bg-zinc-800/50 font-mono text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Уклонение
            </button>
            <button
              type="button"
              disabled={isProcessing || !!combatEvent}
              onClick={() => (resources.energy ?? 0) < 3 ? handleCombatAction('ram') : handleCombatAction('attack')}
              className="flex-1 py-3 rounded border-2 border-red-600 bg-red-900/30 font-mono font-bold text-red-400 hover:bg-red-800/40 hover:border-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {(resources.energy ?? 0) < 3 ? 'Таран' : 'Атака'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setShowCrewPopup(true)}
              className="flex-1 py-3 rounded border-2 border-zinc-600 bg-zinc-800/50 font-mono text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors"
            >
              Команда
            </button>
            <button
              type="button"
              disabled={isEventActive || isWarping}
              onClick={() => {
                const exitId = mapState?.nodes?.find((n) => n.isExit)?.id;
                const isAtExit = exitId != null && mapState?.currentNodeId === exitId;
                if (isAtExit) {
                  handleClusterTransition();
                } else {
                  if (!mapState) setMapState(createInitialMapState());
                  setShowMapPopup(true);
                }
              }}
              className="flex-1 py-3 rounded border-2 border-amber-600 bg-amber-900/30 font-mono font-bold text-amber-400 hover:bg-amber-800/40 hover:border-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-amber-600 disabled:hover:bg-amber-900/30 disabled:hover:text-amber-400"
            >
              {(() => {
                const exitId = mapState?.nodes?.find((n) => n.isExit)?.id;
                const isAtExit = exitId != null && mapState?.currentNodeId === exitId;
                return isAtExit ? 'В следующий кластер' : 'Совершить прыжок';
              })()}
            </button>
          </>
        )}
      </div>

      {showMapPopup && mapState && (
        <MapPopup
          mapState={mapState}
          survey={mapSurvey}
          onNodeClick={handleMapNodeClick}
          onClose={() => setShowMapPopup(false)}
        />
      )}
      {showCrewPopup && (
        <CrewPopup
          crew={gameCrew}
          skillModalMember={crewSkillModalMember}
          onSkillModalClose={() => setCrewSkillModalMember(null)}
          onClose={() => {
            setCrewSkillModalMember(null);
            setShowCrewPopup(false);
          }}
          onManualLevelUp={handleCrewManualLevelUp}
          onLevelChoice={(memberId, optIndex) => {
            setGameCrew((prev) => {
              const next = confirmLevelSkillChoice(prev, memberId, optIndex);
              const mem = next.find((m) => String(m.id) === String(memberId));
              const lastSkill = mem?.skills?.[mem.skills.length - 1];
              if (lastSkill?.effect?.type === 'survey' && typeof lastSkill.effect.survey === 'number') {
                queueMicrotask(() => {
                  setResources((r) => ({
                    ...r,
                    survey: (r.survey ?? 0) + lastSkill.effect.survey,
                  }));
                });
              }
              queueMicrotask(() => {
                if (mem?.pendingLevelChoice && (mem.pendingLevelChoice.opt1 || mem.pendingLevelChoice.opt2)) {
                  setCrewSkillModalMember(mem);
                } else {
                  setCrewSkillModalMember(null);
                }
              });
              return next;
            });
          }}
        />
      )}
    </div>
    </>
  );
}
