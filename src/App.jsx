import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { getResourceLimits, getResourceLabels, RESOURCE_UNITS, DELTA_KEYS, STATUS_VAR_KEYS, applyDeltas, applyDifficultyToDeltas, normalizeDeltaToNewFormat, FIXED_SPEED, FIXED_ATTACK } from './utils/resourceHelpers';
import { saveGame, loadGame, hasSave, clearSave, migrateResources } from './utils/saveGame';
import { createInitialMapState, performJump, serializeMapState, deserializeMapState, isExitNode } from './utils/mapUtils';
import { matchesEventReq, pickCrewNames } from './services/sheetLoader';
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
};

function formatDeltaForLog(delta, extra = {}) {
  const combined = normalizeDeltaToNewFormat({ ...delta, ...extra });
  const labels = getResourceLabels();
  const parts = [];
  Object.entries(combined).forEach(([key, val]) => {
    if (val === 0 || val === undefined) return;
    const label = labels[key] ?? key;
    const unit = RESOURCE_UNITS[key] ?? '';
    const sign = val > 0 ? '+' : '';
    parts.push(`${label}: ${sign}${val}${unit}`);
  });
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
    };
  });
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
  const { events, introSlides, shipStats, crew, fights, fromSheet, loading } = useSheetData();
  const audioRef = useRef(null);

  const [showMenu, setShowMenu] = useState(true);
  const [resources, setResources] = useState(DEFAULT_SHIP_STATS);
  const [turn, setTurn] = useState(0);
  const [eventLog, setEventLog] = useState([]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [isEventActive, setIsEventActive] = useState(false);
  const [stormProgress, setStormProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [introStep, setIntroStep] = useState(0);
  const [playerVars, setPlayerVars] = useState(INITIAL_PLAYER_VARS);
  const [showMapPopup, setShowMapPopup] = useState(false);
  const [showCrewPopup, setShowCrewPopup] = useState(false);
  const [gameCrew, setGameCrew] = useState([]);
  const [pendingCrewInit, setPendingCrewInit] = useState(false);
  const [mapState, setMapState] = useState(null);
  const [isWarping, setIsWarping] = useState(false);
  const [pendingStormProgress, setPendingStormProgress] = useState(null);
  const [musicEnabled, setMusicEnabled] = useState(getMusicEnabled);
  const [nextDestinationEventId, setNextDestinationEventId] = useState(1);
  const [shownEventIds, setShownEventIds] = useState([]);
  const [currentFight, setCurrentFight] = useState(null);
  const [combatTurn, setCombatTurn] = useState(0);
  const [enemyHp, setEnemyHp] = useState(0);
  const [combatEvent, setCombatEvent] = useState(null);
  const [pendingFightEnd, setPendingFightEnd] = useState(null);
  const [pendingCombatAction, setPendingCombatAction] = useState(null);
  const [playerHitTrigger, setPlayerHitTrigger] = useState(0);
  const [enemyHitTrigger, setEnemyHitTrigger] = useState(0);
  const [screenShake, setScreenShake] = useState(false);
  const skipNextDamageEffectRef = useRef(false);

  useEffect(() => {
    if (playerHitTrigger <= 0) return;
    if (skipNextDamageEffectRef.current) {
      skipNextDamageEffectRef.current = false;
      setPlayerHitTrigger(0);
      setEnemyHitTrigger(0);
      return;
    }
    setScreenShake(true);
    const t = setTimeout(() => setScreenShake(false), 350);
    return () => clearTimeout(t);
  }, [playerHitTrigger]);

  useEffect(() => {
    if (enemyHitTrigger <= 0) return;
    if (skipNextDamageEffectRef.current) {
      skipNextDamageEffectRef.current = false;
      setPlayerHitTrigger(0);
      setEnemyHitTrigger(0);
      return;
    }
  }, [enemyHitTrigger]);
  const pendingJumpRef = useRef(null);

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
  const isVictory = stormProgress >= 100;

  useEffect(() => {
    if (isGameOver) clearSave();
  }, [isGameOver]);

  const isDestinationEvent = useCallback((e) => {
    const ev = (e?.event || '').toLowerCase();
    return ev === 'destination_lighthouse' || ev === 'destination_demon';
  }, []);

  const pickNextEvent = useCallback(
    (nextDestId, shownSet, currentTurn) => {
      const dest = playerVars.dest;
      if (currentTurn === 1 && !shownSet.has(getEventKey({ event: 'random', id: 26 }))) {
        const ev26 = events.find((e) => (e?.event || '').toLowerCase() === 'random' && Number(e.id) === 26);
        if (ev26 && matchesEventReq(ev26.event_req, playerVars)) return ev26; // тест боя: ивент 26 только на 2-й ход
      }
      const randomEvents = events.filter(
        (e) => (e?.event || '').toLowerCase() === 'random' && matchesEventReq(e.event_req, playerVars)
      );
      const destEvents = events
        .filter((e) => {
          const ev = (e?.event || '').toLowerCase();
          if (ev === 'destination_lighthouse') return dest === 'lighthouse';
          if (ev === 'destination_demon') return dest === 'demon';
          return false;
        })
        .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));

      const notShown = (e) => !shownSet.has(getEventKey(e));
      const availableRandom = randomEvents.filter(notShown);
      const availableDest = destEvents.filter(notShown);

      const destById = (id) => destEvents.find((e) => Number(e.id) === Number(id));
      const destByIdAvailable = (id) => availableDest.find((e) => Number(e.id) === Number(id));

      if (nextDestId === 1 && destById(1)) {
        const d1 = destByIdAvailable(1) ?? destById(1);
        return d1;
      }
      if (destEvents.length === 0 || randomEvents.length === 0) {
        const fallback = [...destEvents, ...randomEvents].filter(Boolean);
        return fallback[Math.floor(Math.random() * fallback.length)];
      }
      const useDest = destById(nextDestId);
      const useDestAvailable = destByIdAvailable(nextDestId) ?? useDest;
      if (Math.random() < 0.3 && useDestAvailable) {
        return useDestAvailable;
      }
      const pool = availableRandom.length > 0 ? availableRandom : randomEvents;
      return pool[Math.floor(Math.random() * pool.length)];
    },
    [events, playerVars, isDestinationEvent, getEventKey]
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
    const nextMapState = reachedExit ? createInitialMapState() : performJump(mapState, targetNodeId);
    if (!nextMapState) return;

    const isReturnToVisited = !reachedExit && mapState.visitedIds?.has(targetNodeId);
    const passiveApplied = applyPassiveCrewEffects(gameCrew, resources, limits);
    const nextCrew = passiveApplied.crew;
    const afterPassiveResources = passiveApplied.resources;
    const tickResources = applyDeltas(afterPassiveResources, {}, limits);
    const stormGain = isReturnToVisited ? 0 : FIXED_SPEED;
    const newStormProgress = Math.min(100, stormProgress + stormGain);

    setMapState(nextMapState);
    setGameCrew(nextCrew);
    setResources(tickResources);

    const willShowEvent = events.length > 0 && !reachedExit && !isReturnToVisited;
    if (reachedExit || !willShowEvent) {
      setStormProgress(newStormProgress);
    } else {
      setPendingStormProgress(newStormProgress);
    }

    const calmDelta = formatDeltaForLog({});
    const stormStr = stormGain > 0 ? ` | Путь: +${stormGain}%` : '';
    const jumpMsg = reachedExit
      ? `Переход в следующий кластер.${calmDelta}${stormStr}`
      : isReturnToVisited
        ? `Возврат к узлу ${targetNodeId}.${calmDelta}`
        : `Прыжок к узлу ${targetNodeId}.${calmDelta}${stormStr}`;
    const newEventLog = [...eventLog.slice(-5), jumpMsg].slice(-5);

    setEventLog(newEventLog);

    let newNextDestId = nextDestinationEventId;
    let newShownIds = shownEventIds;
    if (willShowEvent) {
      const shownSet = new Set(shownEventIds);
      const event = pickNextEvent(nextDestinationEventId, shownSet, turn);
      if (event) {
        setCurrentEvent(event);
        setIsEventActive(true);
        newShownIds = [...shownEventIds, getEventKey(event)];
        setShownEventIds(newShownIds);
        if (isDestinationEvent(event)) {
          newNextDestId = (Number(event.id) || 0) + 1;
          setNextDestinationEventId(newNextDestId);
        }
      } else {
        setEventLog((prev) => [...prev.slice(-5), '[Ошибка: не удалось выбрать событие]']);
        setStormProgress(newStormProgress);
        setPendingStormProgress(null);
      }
    }

    saveGame({
      resources: tickResources,
      turn,
      eventLog: newEventLog,
      stormProgress: newStormProgress,
      playerVars,
      crew: nextCrew,
      mapState: serializeMapState(nextMapState),
      nextDestinationEventId: newNextDestId,
      shownEventIds: newShownIds,
      currentFight,
      combatTurn,
      enemyHp,
    });
  }, [mapState, gameCrew, resources, limits, turn, stormProgress, playerVars, events, pickNextEvent, isDestinationEvent, nextDestinationEventId, shownEventIds, getEventKey, eventLog, currentFight, combatTurn, enemyHp]);

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

      const resourceDelta = {};
      const statusFromDelta = {};
      Object.entries(delta).forEach(([k, v]) => {
        if (DELTA_KEYS.includes(k) && typeof v === 'number') resourceDelta[k] = v;
        else if (STATUS_VAR_KEYS.includes(k) && typeof v === 'string') statusFromDelta[k] = v;
      });
      setVariable = { ...statusFromDelta, ...setVariable };
      if (Object.keys(setVariable).length === 0) setVariable = null;

      const difficultyMultiplier = stormProgress > 50 ? 1.2 : 1;
      const finalDelta = applyDifficultyToDeltas(resourceDelta, difficultyMultiplier);

      const hullDamage = (finalDelta.hull ?? 0) < 0 ? Math.abs(Math.round(finalDelta.hull)) : 0;
      const nextCrew = hullDamage > 0 ? distributeHullDamageToCrew(gameCrew, hullDamage) : gameCrew;

      const afterChoice = applyDeltas(resources, finalDelta, limits);
      const newPlayerVars = setVariable ? { ...playerVars, ...setVariable } : playerVars;
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
          if ((enemyDamageFromChoice ?? 0) > 0) setEnemyHitTrigger((t) => t + 1);
          const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
          const deltaStr = formatDeltaForLog(finalDelta);
          setResources(afterChoice);
          setGameCrew(nextCrew);
          setCurrentEvent(null);
          setIsEventActive(false);
          setIsProcessing(false);
          setCurrentFight(fightData);
          setCombatTurn(1);
          setEnemyHp(initialEnemyHp);
          const newEventLog = [
            ...eventLog.slice(-5),
            `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`,
            `Бой начался: ${fightData.name}`,
          ].slice(-5);
          setEventLog(newEventLog);
          saveGame({
            resources: afterChoice,
            turn,
            eventLog: newEventLog,
            stormProgress,
            playerVars: newPlayerVars,
            crew: nextCrew,
            mapState: mapState ? serializeMapState(mapState) : null,
            nextDestinationEventId,
            shownEventIds,
            currentFight: fightData,
            combatTurn: 1,
            enemyHp: initialEnemyHp,
          });
          return;
        }
        console.warn('[Combat] fightId=', JSON.stringify(fightId), 'setVariable=', setVariable, 'fights=', fights?.map((f) => f.id) ?? 'null', 'fightsCount=', fights?.length ?? 0);
      }

      setResources(afterChoice);
      setGameCrew(nextCrew);

      if (pendingStormProgress != null) {
        setStormProgress(pendingStormProgress);
        setPendingStormProgress(null);
      }

      const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
      const deltaStr = formatDeltaForLog(finalDelta);
      setEventLog((prev) => [
        ...prev.slice(-5),
        `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`,
      ].slice(-5));

      setTurn((t) => t + 1);
      setCurrentEvent(null);
      setIsEventActive(false);
      setIsProcessing(false);

      const isDead = (afterChoice.hull ?? 0) <= 0;
      if (!isDead) {
        const newTurn = turn + 1;
        const newStormProgress = pendingStormProgress ?? stormProgress;
        const newEventLog = [...eventLog, `Ход ${newTurn}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`].slice(-5);
        saveGame({
          resources: afterChoice,
          turn: newTurn,
          eventLog: newEventLog,
          stormProgress: newStormProgress,
          playerVars: newPlayerVars,
          crew: nextCrew,
          mapState: mapState ? serializeMapState(mapState) : null,
          nextDestinationEventId,
          shownEventIds,
          currentFight,
          combatTurn,
          enemyHp,
        });
      }
    },
    [currentEvent, isProcessing, limits, resources, stormProgress, pendingStormProgress, turn, eventLog, playerVars, gameCrew, mapState, nextDestinationEventId, shownEventIds, fights, currentFight, combatTurn, enemyHp]
  );

  const findEventByIdOrTitle = useCallback(
    (ref) => {
      if (!ref || !events?.length) return null;
      const s = String(ref).trim();
      return events.find((e) => String(e.id) === s || (e.event || '').trim() === s || (e.title || '').trim() === s) || null;
    },
    [events]
  );

  const finishCombat = useCallback(
    (win) => {
      setPlayerVars((prev) => ({ ...prev, fight: win ? 'win' : 'lose' }));
      setCurrentFight(null);
      setEnemyHp(0);
      setPendingFightEnd(null);
      setPendingCombatAction(null);
      setCombatEvent(null);
      if (!win) {
        setEventLog((prev) => [...prev.slice(-5), 'Корабль уничтожен. Поражение.'].slice(-5));
      } else {
        setEventLog((prev) => [...prev.slice(-5), 'Враг повержен! Победа!'].slice(-5));
      }
    },
    []
  );

  const runCombatTurn = useCallback(
    (playerDamageDealt, playerDamageTaken, actionName) => {
      if (!currentFight) return;
      if (playerDamageTaken > 0) setPlayerHitTrigger((t) => t + 1);
      if (playerDamageDealt > 0) setEnemyHitTrigger((t) => t + 1);
      const newEnemyHp = Math.max(0, enemyHp - playerDamageDealt);
      const hullDamage = Math.min(playerDamageTaken, resources.hull ?? 0);
      const newHull = Math.max(0, (resources.hull ?? 0) - playerDamageTaken);
      const nextCrew = hullDamage > 0 ? distributeHullDamageToCrew(gameCrew, hullDamage) : gameCrew;
      setEnemyHp(newEnemyHp);
      let afterCombatResources = { ...resources, hull: newHull };
      if (actionName === 'Атака') afterCombatResources = applyDeltas(afterCombatResources, { energy: -3 }, limits);
      setResources(afterCombatResources);
      if (hullDamage > 0) setGameCrew(nextCrew);
      const newEventLog = [...eventLog.slice(-5), `Ход ${combatTurn}: ${actionName}. Вы нанесли ${playerDamageDealt} урона, получили ${playerDamageTaken} урона.`].slice(-5);
      setEventLog(newEventLog);
      const combatEnded = newEnemyHp <= 0 || newHull <= 0;
      if (combatEnded) {
        const endEventRef = currentFight.endFightEvent;
        const endEvent = findEventByIdOrTitle(endEventRef);
        const won = newEnemyHp <= 0;
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
          stormProgress,
          playerVars: endPlayerVars,
          crew: nextCrew,
          mapState: mapState ? serializeMapState(mapState) : null,
          nextDestinationEventId,
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
        stormProgress,
        playerVars,
        crew: nextCrew,
        mapState: mapState ? serializeMapState(mapState) : null,
        nextDestinationEventId,
        shownEventIds,
        currentFight,
        combatTurn: nextTurn,
        enemyHp: newEnemyHp,
      });
    },
    [currentFight, enemyHp, resources, combatTurn, eventLog, mapState, playerVars, turn, stormProgress, nextDestinationEventId, shownEventIds, findEventByIdOrTitle, finishCombat, gameCrew, limits]
  );

  const handleCombatAction = useCallback(
    (action) => {
      if (!currentFight || isProcessing) return;
      if (action === 'attack' && (resources.energy ?? 0) < 3) {
        setEventLog((prev) => [...prev.slice(-5), 'Недостаточно энергии для атаки (нужно 3).'].slice(-5));
        return;
      }
      setIsProcessing(true);
      const enemyDamage = rollNd6(currentFight.attackD6);
      let playerDamageDealt = 0;
      let playerDamageTaken = enemyDamage;
      let actionName = '';

      if (action === 'attack') {
        playerDamageDealt = rollNd6(2);
        actionName = 'Атака';
      } else if (action === 'dodge') {
        const dodgeRoll = Math.random();
        if (dodgeRoll < 0.5) playerDamageTaken = 0;
        else playerDamageTaken = Math.floor(enemyDamage / 2);
        actionName = 'Уклонение';
      } else if (action === 'flee') {
        const demonOk = playerVars.demon && playerVars.demon !== 'сбежал';
        if (combatTurn >= 3 && demonOk) {
          setCurrentFight(null);
          setEnemyHp(0);
          setPlayerVars((prev) => ({ ...prev, fight: 'win' }));
          setEventLog((prev) => [...prev.slice(-5), `Ход ${combatTurn}: Сбежать. Вы сбежали с поля боя.`].slice(-5));
          setIsProcessing(false);
          return;
        }
        setIsProcessing(false);
        return;
      }

      // Сначала проверяем ивент (50%): если есть — показываем, урон применится после выбора
      const turnIndex = Math.min(combatTurn - 1, 4);
      const turnEventRef = currentFight.eventTurns?.[turnIndex];
      if (Math.random() < 0.5 && turnEventRef) {
        const ev = findEventByIdOrTitle(turnEventRef);
        if (ev) {
          setPendingCombatAction({ playerDamageDealt, playerDamageTaken, actionName });
          setCombatEvent(ev);
          setIsProcessing(false);
          return;
        }
      }

      runCombatTurn(playerDamageDealt, playerDamageTaken, actionName);
      setIsProcessing(false);
    },
    [currentFight, combatTurn, isProcessing, playerVars.demon, resources.energy, runCombatTurn, findEventByIdOrTitle]
  );

  const handleCombatEventChoice = useCallback(
    (choice) => {
      if (!combatEvent) return;
      const delta = choice?.delta ?? {};
      const setVariable = choice?.setVariable ?? {};
      const choiceEnemyDamage = choice?.enemyDamage ?? 0;
      const choiceHullDamage = (delta.hull ?? 0) < 0 ? Math.abs(Math.round(delta.hull)) : 0;
      let nextCrew = choiceHullDamage > 0 ? distributeHullDamageToCrew(gameCrew, choiceHullDamage) : gameCrew;
      let afterResources = applyDeltas(resources, delta, limits);
      if (Object.keys(setVariable).length > 0) setPlayerVars((p) => ({ ...p, ...setVariable }));

      setEventLog((prev) => [...prev.slice(-5), `Бой: ${combatEvent.title} → "${choice?.text || 'Продолжить'}"`].slice(-5));
      setCombatEvent(null);

      const pending = pendingCombatAction;
      setPendingCombatAction(null);

      if (pending) {
        const { playerDamageDealt, playerDamageTaken, actionName } = pending;
        if (playerDamageTaken > 0 || choiceHullDamage > 0) setPlayerHitTrigger((t) => t + 1);
        if (playerDamageDealt > 0 || choiceEnemyDamage > 0) setEnemyHitTrigger((t) => t + 1);

        const combatHullDamage = Math.min(playerDamageTaken, afterResources.hull ?? 0);
        const newHull = Math.max(0, (afterResources.hull ?? 0) - playerDamageTaken);
        nextCrew = combatHullDamage > 0 ? distributeHullDamageToCrew(nextCrew, combatHullDamage) : nextCrew;
        const totalEnemyDamage = playerDamageDealt + choiceEnemyDamage;
        const newEnemyHp = Math.max(0, (enemyHp ?? 0) - totalEnemyDamage);

        let finalResources = { ...afterResources, hull: newHull };
        if (actionName === 'Атака') finalResources = applyDeltas(finalResources, { energy: -3 }, limits);
        setResources(finalResources);
        setGameCrew(nextCrew);
        setEnemyHp(newEnemyHp);
        setEventLog((prev) => [...prev.slice(-5), `Ход ${combatTurn}: ${actionName}. Вы нанесли ${playerDamageDealt} урона, получили ${playerDamageTaken} урона.`].slice(-5));

        const combatEnded = newEnemyHp <= 0 || newHull <= 0;
        if (combatEnded) {
          const endEventRef = currentFight?.endFightEvent;
          const endEvent = findEventByIdOrTitle(endEventRef);
          const won = newEnemyHp <= 0;
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
            eventLog: [...eventLog.slice(-5), `Бой: ${combatEvent.title} → "${choice?.text || 'Продолжить'}"`, `Ход ${combatTurn}: ${actionName}. Вы нанесли ${playerDamageDealt} урона, получили ${playerDamageTaken} урона.`].slice(-5),
            stormProgress,
            playerVars: { ...playerVars, ...setVariable, fight: won ? 'win' : 'lose' },
            crew: nextCrew,
            mapState: mapState ? serializeMapState(mapState) : null,
            nextDestinationEventId,
            shownEventIds,
            currentFight: endEvent ? currentFight : null,
            combatTurn: combatTurn,
            enemyHp: 0,
          });
        } else {
          const nextTurn = combatTurn + 1;
          setCombatTurn(nextTurn);
          saveGame({
            resources: finalResources,
            turn,
            eventLog: [...eventLog.slice(-5), `Бой: ${combatEvent.title} → "${choice?.text || 'Продолжить'}"`, `Ход ${combatTurn}: ${actionName}. Вы нанесли ${playerDamageDealt} урона, получили ${playerDamageTaken} урона.`].slice(-5),
            stormProgress,
            playerVars: { ...playerVars, ...setVariable },
            crew: nextCrew,
            mapState: mapState ? serializeMapState(mapState) : null,
            nextDestinationEventId,
            shownEventIds,
            currentFight,
            combatTurn: nextTurn,
            enemyHp: newEnemyHp,
          });
        }
      } else {
        if (choiceHullDamage > 0) setPlayerHitTrigger((t) => t + 1);
        if (choiceEnemyDamage > 0) setEnemyHitTrigger((t) => t + 1);
        setResources(afterResources);
        if (choiceHullDamage > 0) setGameCrew(nextCrew);
        const newEnemyHp = Math.max(0, (enemyHp ?? 0) - choiceEnemyDamage);
        setEnemyHp(newEnemyHp);
        if (pendingFightEnd) {
          finishCombat(pendingFightEnd.win);
        } else if ((afterResources.hull ?? 0) <= 0) {
          finishCombat(false);
        } else if (newEnemyHp <= 0) {
          const endEventRef = currentFight?.endFightEvent;
          const endEvent = findEventByIdOrTitle(endEventRef);
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
    [combatEvent, pendingFightEnd, pendingCombatAction, limits, finishCombat, gameCrew, resources, enemyHp, combatTurn, eventLog, currentFight, findEventByIdOrTitle, mapState, playerVars, turn, stormProgress, nextDestinationEventId, shownEventIds]
  );

  const handleIntroNext = useCallback(
    (choice) => {
      if (choice?.setVariable) {
        setPlayerVars((prev) => ({ ...prev, ...choice.setVariable }));
      }
      if (choice?.delta && typeof choice.delta === 'object' && Object.keys(choice.delta).length > 0) {
        setResources((prev) => applyDeltas(prev, choice.delta, limits));
      }
      const nextStep = introStep + 1;
      setIntroStep(nextStep);
    },
    [limits, introStep]
  );

  const handleNewGame = useCallback(() => {
    clearSave();
    skipNextDamageEffectRef.current = true;
    setResources(withFixedShipStats(shipStats ?? DEFAULT_SHIP_STATS));
    const preparedCrew = rollInitialCrewDamage(pickCrewNames(crew));
    setGameCrew(preparedCrew);
    setPendingCrewInit(preparedCrew.length === 0);
    setMapState(createInitialMapState());
    setPendingStormProgress(null);
    setTurn(0);
    setEventLog([]);
    setCurrentEvent(null);
    setIsEventActive(false);
    setStormProgress(0);
    setIsProcessing(false);
    setIntroStep(0);
    setPlayerVars(INITIAL_PLAYER_VARS);
    setNextDestinationEventId(1);
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
    skipNextDamageEffectRef.current = true;
    setResources(withFixedShipStats(migrateResources(saved.resources) ?? shipStats ?? DEFAULT_SHIP_STATS));
    setGameCrew(saved.crew ?? []);
    setPendingCrewInit(false);
    setMapState(deserializeMapState(saved.mapState) ?? createInitialMapState());
    setPendingStormProgress(null);
    setTurn(saved.turn ?? 0);
    setEventLog((saved.eventLog ?? []).slice(-5));
    setCurrentEvent(null);
    setIsEventActive(false);
    setStormProgress(saved.stormProgress ?? 0);
    setIsProcessing(false);
    setPlayerVars(saved.playerVars ?? INITIAL_PLAYER_VARS);
    setNextDestinationEventId(saved.nextDestinationEventId ?? 1);
    setShownEventIds(saved.shownEventIds ?? []);
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
    setPendingStormProgress(null);
    setTurn(0);
    setEventLog([]);
    setCurrentEvent(null);
    setIsEventActive(false);
    setStormProgress(0);
    setIsProcessing(false);
    setIntroStep(0);
    setPlayerVars(INITIAL_PLAYER_VARS);
    setNextDestinationEventId(1);
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
          Пространственное ядро стабилизировано. Вы вышли из бури за {turn} ходов.
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
      <div className={`min-h-screen bg-zinc-950 text-zinc-300 font-mono p-4 ${screenShake ? 'animate-screen-shake' : ''}`}>
      <header className="mb-2 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              saveGame({ resources, turn, eventLog, stormProgress, playerVars, crew: gameCrew, mapState: mapState ? serializeMapState(mapState) : null, nextDestinationEventId, shownEventIds, currentFight, combatTurn, enemyHp });
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
        <div className="text-cyan-500/90 text-sm font-semibold mb-2">
          Курс на {playerVars.dest === 'demon' ? 'поиски демона' : playerVars.dest === 'market' ? 'Мир-Рынок' : playerVars.dest === 'lighthouse' ? 'Планарный Маяк' : '—'}
        </div>
        <div className="h-4 bg-zinc-800 rounded overflow-hidden border border-zinc-600">
          <div
            className="h-full bg-gradient-to-r from-cyan-700 to-emerald-600 transition-all duration-300"
            style={{ width: `${stormProgress}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1 tabular-nums">{stormProgress}%</p>
      </div>

      <ShipDisplay
        isWarping={isWarping}
        onWarpEnd={handleWarpEnd}
        enemy={currentFight ? { icon: currentFight.icon, name: currentFight.name, hp: enemyHp, maxHp: currentFight.hp } : null}
        playerHitTrigger={playerHitTrigger}
        enemyHitTrigger={enemyHitTrigger}
      />

      <InfoPanel playerVars={playerVars} resources={resources} />

      <EventPopup
        event={currentEvent || combatEvent}
        onChoice={combatEvent ? handleCombatEventChoice : handleChoice}
        disabled={isProcessing}
        playerVars={playerVars}
      />

      <EventLog entries={eventLog} />

      <div className="mb-2 flex justify-between gap-4">
        {currentFight ? (
          <>
            <button
              type="button"
              disabled={isProcessing || combatTurn < 3 || !playerVars.demon || playerVars.demon === 'сбежал'}
              onClick={() => handleCombatAction('flee')}
              className="flex-1 py-3 rounded border-2 border-zinc-600 bg-zinc-800/50 font-mono text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Сбежать
            </button>
            <button
              type="button"
              disabled={isProcessing}
              onClick={() => handleCombatAction('dodge')}
              className="flex-1 py-3 rounded border-2 border-zinc-600 bg-zinc-800/50 font-mono text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Уклонение
            </button>
            <button
              type="button"
              disabled={isProcessing || (resources.energy ?? 0) < 3}
              onClick={() => handleCombatAction('attack')}
              className="flex-1 py-3 rounded border-2 border-red-600 bg-red-900/30 font-mono font-bold text-red-400 hover:bg-red-800/40 hover:border-red-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Атака
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
                if (!mapState) setMapState(createInitialMapState());
                setShowMapPopup(true);
              }}
              className="flex-1 py-3 rounded border-2 border-amber-600 bg-amber-900/30 font-mono font-bold text-amber-400 hover:bg-amber-800/40 hover:border-amber-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-amber-600 disabled:hover:bg-amber-900/30 disabled:hover:text-amber-400"
            >
              Совершить прыжок
            </button>
          </>
        )}
      </div>

      {showMapPopup && mapState && (
        <MapPopup
          mapState={mapState}
          onNodeClick={handleMapNodeClick}
          onClose={() => setShowMapPopup(false)}
        />
      )}
      {showCrewPopup && <CrewPopup crew={gameCrew} onClose={() => setShowCrewPopup(false)} />}
    </div>
    </>
  );
}
