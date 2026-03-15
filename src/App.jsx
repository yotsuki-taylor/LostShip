import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { ENERGY_REGEN_PER_TURN } from './data/events';
import { getResourceLimits, getResourceLabels, RESOURCE_UNITS, DELTA_KEYS, STATUS_VAR_KEYS, applyDeltas, applyDifficultyToDeltas, normalizeDeltaToNewFormat } from './utils/resourceHelpers';
import { saveGame, loadGame, hasSave, clearSave, migrateResources } from './utils/saveGame';
import { matchesEventReq } from './services/sheetLoader';
import { useSheetData } from './hooks/useSheetData';
import { DEFAULT_SHIP_STATS } from './services/sheetLoader';
import { StatusPanel } from './components/StatusPanel';
import { ResourcePanel } from './components/ResourcePanel';
import { EventLog } from './components/EventLog';
import { EventPopup } from './components/EventPopup';
import { IntroPopup } from './components/IntroPopup';
import { StartMenu } from './components/StartMenu';
import { ShipDisplay } from './components/ShipDisplay';


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

export default function App() {
  const { events, introSlides, shipStats, fromSheet } = useSheetData();
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

  const limits = useMemo(() => getResourceLimits(), []);

  useEffect(() => {
    if (!showMenu && audioRef.current) {
      audioRef.current.play().catch(() => {});
    }
  }, [showMenu]);

  // Синхронизация ресурсов со статами из таблицы при загрузке (для меню и новой игры)
  useEffect(() => {
    if (shipStats && showMenu) {
      setResources(shipStats);
    }
  }, [shipStats, showMenu]);

  const isGameOver = (resources.hull ?? 0) <= 0 || (resources.morale ?? 0) <= 0;
  const isVictory = stormProgress >= 100;

  const pickRandomEvent = useCallback(() => {
    const eligible = events.filter((e) => matchesEventReq(e.event_req, playerVars));
    const pool = eligible.length > 0 ? eligible : events;
    return pool[Math.floor(Math.random() * pool.length)];
  }, [events, playerVars]);

  const handleWait = useCallback(() => {
    if (isEventActive || isGameOver || isVictory) return;

    const roll = Math.random();
    const isFirstClick = turn === 0;
    const gotEvent = isFirstClick || roll < 0.7;

    setResources((prev) => applyDeltas(prev, { energy: 2 }, limits));
    setTurn((t) => t + 1);

    if (gotEvent && events.length > 0) {
      const event = pickRandomEvent();
      if (event) {
        setCurrentEvent(event);
        setIsEventActive(true);
      } else {
        setEventLog((prev) => [...prev.slice(-5), '[Ошибка: не удалось выбрать событие]']);
      }
    } else {
      const calmDelta = formatDeltaForLog({ energy: 2 });
      const newLog = [...eventLog.slice(-5), (gotEvent ? '[Ошибка: нет событий]' : 'В буре затишье. Системы стабильны.') + calmDelta].slice(-5);
      setEventLog(newLog);
      const newResources = applyDeltas(resources, { energy: 2 }, limits);
      saveGame({
        resources: newResources,
        turn: turn + 1,
        eventLog: newLog,
        stormProgress,
        playerVars,
      });
    }
  }, [isEventActive, isGameOver, isVictory, limits, turn, resources, eventLog, stormProgress, playerVars, events, pickRandomEvent]);

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

      const stormGain = 2 + Math.floor(Math.random() * 4) + (resources.speed ?? 0);
      setStormProgress((p) => Math.min(100, p + stormGain));

      const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
      const deltaStr = formatDeltaForLog(finalDelta, { energy: ENERGY_REGEN_PER_TURN });
      const stormStr = stormGain > 0 ? ` | Буря: +${stormGain}%` : '';
      setEventLog((prev) => [
        ...prev.slice(-5),
        `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}${stormStr}`,
      ].slice(-5));

      setTurn((t) => t + 1);
      setCurrentEvent(null);
      setIsEventActive(false);
      setIsProcessing(false);

      const isDead = (afterRegen.hull ?? 0) <= 0 || (afterRegen.morale ?? 0) <= 0;
      if (!isDead) {
        const newTurn = turn + 1;
        const newStormProgress = Math.min(100, stormProgress + stormGain);
        const newEventLog = [...eventLog, `Ход ${newTurn}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}${stormStr}`].slice(-5);
        saveGame({
          resources: afterRegen,
          turn: newTurn,
          eventLog: newEventLog,
          stormProgress: newStormProgress,
          playerVars: newPlayerVars,
        });
      }
    },
    [currentEvent, isProcessing, limits, resources, stormProgress, turn, eventLog, playerVars]
  );

  const handleIntroNext = useCallback((choice) => {
    if (choice?.setVariable) {
      setPlayerVars((prev) => ({ ...prev, ...choice.setVariable }));
    }
    setIntroStep((s) => s + 1);
  }, []);

  const handleNewGame = useCallback(() => {
    clearSave();
    setResources(shipStats ?? DEFAULT_SHIP_STATS);
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
  }, [shipStats]);

  const handleContinue = useCallback(() => {
    const saved = loadGame();
    if (!saved) return;
    setResources(migrateResources(saved.resources) ?? shipStats ?? DEFAULT_SHIP_STATS);
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
  }, [introSlides.length]);

  const handleRestart = useCallback(() => {
    if (isVictory) clearSave();
    setResources(shipStats ?? DEFAULT_SHIP_STATS);
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
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" />
        <StartMenu
        onNewGame={handleNewGame}
        onContinue={handleContinue}
        hasSave={hasSave()}
      />
      </>
    );
  }

  if (introStep < introSlides.length) {
    return (
      <>
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" />
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
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" />
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
        <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" />
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
      <audio ref={audioRef} src={MUSIC_PATH} loop preload="auto" />
      <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono p-4">
      <header className="mb-4 border-b-2 border-zinc-700 pb-2 flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-amber-500/90 tracking-wider">
            LOST SHIP
          </h1>
          <p className="text-xs text-zinc-500">Ход: {turn}</p>
        </div>
        {fromSheet && (
          <span className="text-xs text-emerald-500/80">Таблица подключена</span>
        )}
      </header>

      <div className="mb-4 terminal-panel p-3">
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

      <ShipDisplay />

      <div className="mb-4">
        <StatusPanel playerVars={playerVars} />
        <ResourcePanel resources={resources} />
      </div>

      <div className="mb-4 flex justify-center">
        <button
          type="button"
          disabled={isEventActive}
          onClick={handleWait}
          className="px-12 py-4 rounded-lg border-2 border-amber-600 bg-amber-900/30 font-bold text-amber-400 text-lg tracking-wider hover:bg-amber-800/40 hover:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-900/30 transition-colors"
        >
          {isEventActive ? 'ОЖИДАНИЕ РЕШЕНИЯ...' : 'ПРОДОЛЖИТЬ ПУТЬ'}
        </button>
      </div>

      <EventPopup
        event={currentEvent}
        onChoice={handleChoice}
        disabled={isProcessing}
        playerVars={playerVars}
      />

      <EventLog entries={eventLog} />
    </div>
    </>
  );
}
