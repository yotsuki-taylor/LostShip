import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ENERGY_REGEN_PER_TURN } from './data/events';
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
  const { events, introSlides, shipStats, crew, fromSheet } = useSheetData();
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
  const pendingJumpRef = useRef(null);

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

  const pickRandomEvent = useCallback(() => {
    const eligible = events.filter((e) => matchesEventReq(e.event_req, playerVars));
    const pool = eligible.length > 0 ? eligible : events;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [events, playerVars]);

  const handleMapNodeClick = useCallback(
    (targetNodeId) => {
      if (isEventActive || isGameOver || isVictory || !mapState) return;
      pendingJumpRef.current = targetNodeId;
      setShowMapPopup(false);
      setIsWarping(true);
    },
    [isEventActive, isGameOver, isVictory, mapState]
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
    const tickResources = applyDeltas(afterPassiveResources, { energy: 2 }, limits);
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

    const calmDelta = formatDeltaForLog({ energy: 2 });
    const stormStr = stormGain > 0 ? ` | Путь: +${stormGain}%` : '';
    const jumpMsg = reachedExit
      ? `Переход в следующий кластер.${calmDelta}${stormStr}`
      : isReturnToVisited
        ? `Возврат к узлу ${targetNodeId}.${calmDelta}`
        : `Прыжок к узлу ${targetNodeId}.${calmDelta}${stormStr}`;
    const newEventLog = [...eventLog.slice(-5), jumpMsg].slice(-5);

    setEventLog(newEventLog);

    if (willShowEvent) {
      const event = pickRandomEvent();
      if (event) {
        setCurrentEvent(event);
        setIsEventActive(true);
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
    });
  }, [mapState, gameCrew, resources, limits, turn, stormProgress, playerVars, events, pickRandomEvent, eventLog]);

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

      const afterChoice = applyDeltas(resources, finalDelta, limits);
      const newPlayerVars = setVariable ? { ...playerVars, ...setVariable } : playerVars;
      if (setVariable) setPlayerVars(newPlayerVars);
      const afterRegen = applyDeltas(afterChoice, { energy: ENERGY_REGEN_PER_TURN }, limits);
      setResources(afterRegen);

      if (pendingStormProgress != null) {
        setStormProgress(pendingStormProgress);
        setPendingStormProgress(null);
      }

      const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
      const deltaStr = formatDeltaForLog(finalDelta, { energy: ENERGY_REGEN_PER_TURN });
      setEventLog((prev) => [
        ...prev.slice(-5),
        `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`,
      ].slice(-5));

      setTurn((t) => t + 1);
      setCurrentEvent(null);
      setIsEventActive(false);
      setIsProcessing(false);

      const isDead = (afterRegen.hull ?? 0) <= 0;
      if (!isDead) {
        const newTurn = turn + 1;
        const newStormProgress = pendingStormProgress ?? stormProgress;
        const newEventLog = [...eventLog, `Ход ${newTurn}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}`].slice(-5);
        saveGame({
          resources: afterRegen,
          turn: newTurn,
          eventLog: newEventLog,
          stormProgress: newStormProgress,
          playerVars: newPlayerVars,
          crew: gameCrew,
          mapState: mapState ? serializeMapState(mapState) : null,
        });
      }
    },
    [currentEvent, isProcessing, limits, resources, stormProgress, pendingStormProgress, turn, eventLog, playerVars, gameCrew, mapState]
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
    setShowMenu(false);
    audioRef.current?.play().catch(() => {});
  }, [shipStats, crew]);

  const handleContinue = useCallback(() => {
    const saved = loadGame();
    if (!saved) return;
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
    setShowMenu(true);
  }, [isVictory, shipStats]);

  if (showMenu) {
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
      <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono p-4">
      <header className="mb-2 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              saveGame({ resources, turn, eventLog, stormProgress, playerVars, crew: gameCrew, mapState: mapState ? serializeMapState(mapState) : null });
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

      <ShipDisplay isWarping={isWarping} onWarpEnd={handleWarpEnd} />

      <InfoPanel playerVars={playerVars} resources={resources} />

      <EventPopup
        event={currentEvent}
        onChoice={handleChoice}
        disabled={isProcessing}
        playerVars={playerVars}
      />

      <EventLog entries={eventLog} />

      <div className="mb-2 flex justify-between gap-4">
        <button
          type="button"
          disabled={isEventActive || isWarping}
          onClick={() => {
            if (!mapState) setMapState(createInitialMapState());
            setShowMapPopup(true);
          }}
          className="flex-1 py-3 rounded border-2 border-zinc-600 bg-zinc-800/50 font-mono text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-zinc-600 disabled:hover:text-zinc-300"
        >
          Карта
        </button>
        <button
          type="button"
          onClick={() => setShowCrewPopup(true)}
          className="flex-1 py-3 rounded border-2 border-zinc-600 bg-zinc-800/50 font-mono text-zinc-300 hover:border-amber-500 hover:text-amber-400 transition-colors"
        >
          Команда
        </button>
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
