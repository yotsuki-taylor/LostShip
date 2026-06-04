import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { getResourceLimits, getResourceLabels, RESOURCE_UNITS, DELTA_KEYS, STATUS_VAR_KEYS, applyDeltas, applyDifficultyToDeltas, normalizeDeltaToNewFormat, FIXED_SPEED, FIXED_ATTACK } from './utils/resourceHelpers';
import { saveGame, loadGame, hasSave, clearSave, migrateResources } from './utils/saveGame';
import {
  createInitialMapState,
  serializeMapState,
  deserializeMapState,
} from './utils/mapUtils';
import { matchesEventReq, pickCrewNames, pickCriticalEvent } from './services/sheetLoader';
import {
  applyTeamXpReward,
  applyCrewMemberXpBySlug,
  getTurnStartSkillResourceDelta,
  confirmLevelSkillChoice,
  normalizeCrewMember,
  executeManualLevelUp,
} from './utils/crewXp';
import { distributeHullDamageToCrew, rollInitialCrewDamage } from './utils/combatHelpers';
import { formatDeltaForLog } from './utils/formatHelpers';
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
import { useEventPicker } from './hooks/useEventPicker';
import { useCombat } from './hooks/useCombat';
import { useNavigation } from './hooks/useNavigation';


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
  const [musicEnabled, setMusicEnabled] = useState(getMusicEnabled);
  const [nextDestByDestination, setNextDestByDestination] = useState({ lighthouse: 1, demon: 1 });
  const [shownEventIds, setShownEventIds] = useState([]);
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

  const { getEventKey, isDestinationEvent, pickStoryEvent, pickRandomEvent, pickMarketEvent, findEventByIdOrTitle } = useEventPicker({
    events, playerVars, resources,
  });

  const {
    currentFight, setCurrentFight,
    combatTurn, setCombatTurn,
    enemyHp, setEnemyHp,
    combatEvent, setCombatEvent,
    pendingFightEnd, setPendingFightEnd,
    pendingCombatAction,
    playerHitTrigger, setPlayerHitTrigger,
    enemyHitTrigger, setEnemyHitTrigger,
    ramTrigger,
    screenShake,
    ramShake,
    combatCrewHullDamageAccumRef,
    startCombat,
    finishCombat,
    runCombatTurn,
    handleCombatAction,
    handleCombatEventChoice,
    FLEE_BUTTON_COST_TEXT,
  } = useCombat({
    resources, setResources,
    gameCrew, setGameCrew,
    playerVars, setPlayerVars,
    eventLog, setEventLog,
    turn,
    mapState: null, // will be provided via navigation hook, but combat doesn't own mapState directly
    nextDestByDestination, shownEventIds,
    limits, fights, crew, events,
    findEventByIdOrTitle, getCriticalResource,
    isProcessing, setIsProcessing,
    setCurrentEvent, setCurrentCriticalResource,
  });

  const {
    mapState, setMapState,
    isWarping,
    mapSurvey,
    handleMapNodeClick,
    handleWarpEnd,
    handleClusterTransition,
  } = useNavigation({
    resources, setResources,
    gameCrew, setGameCrew,
    playerVars, setPlayerVars,
    eventLog, setEventLog,
    turn, limits, criticalPenalties, events, fights,
    isEventActive, isGameOver, isVictory,
    currentFight, combatTurn, enemyHp,
    nextDestByDestination, setNextDestByDestination,
    shownEventIds, setShownEventIds,
    pickStoryEvent, pickRandomEvent, pickMarketEvent,
    isDestinationEvent, getEventKey, findEventByIdOrTitle,
    getCriticalResource,
    setCurrentEvent, setIsEventActive, setCurrentCriticalResource,
    startCombat,
  });

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
    [currentEvent, isProcessing, limits, resources, turn, eventLog, playerVars, gameCrew, mapState, nextDestByDestination, shownEventIds, fights, currentFight, combatTurn, enemyHp, findEventByIdOrTitle, currentCriticalResource, criticalPenalties, getCriticalResource, events, pendingFightEnd, crew, combatCrewHullDamageAccumRef, setCurrentFight, setCombatTurn, setEnemyHp, setCombatEvent, setEnemyHitTrigger]
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
  }, [shipStats, crew, setPlayerHitTrigger, setEnemyHitTrigger, setMapState, setCurrentFight, setCombatTurn, setEnemyHp, setCombatEvent, setPendingFightEnd]);

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
  }, [introSlides.length, shipStats, setPlayerHitTrigger, setEnemyHitTrigger, setMapState, combatCrewHullDamageAccumRef, setCurrentFight, setCombatTurn, setEnemyHp, setCombatEvent, setPendingFightEnd]);

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
  }, [isVictory, shipStats, setMapState, setCurrentFight, setCombatTurn, setEnemyHp, setCombatEvent, setPendingFightEnd]);

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

function isDemonSubordinate(demon) {
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
