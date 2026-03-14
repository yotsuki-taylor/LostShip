import React, { useState, useCallback, useMemo } from 'react';
import { events, ENERGY_REGEN_PER_TURN } from './data/events';
import { SHIP_MODULES } from './data/modules';
import { getResourceLimits, applyDeltas, applyDifficultyToDeltas } from './utils/resourceHelpers';
import { ResourcePanel } from './components/ResourcePanel';
import { EventLog } from './components/EventLog';
import { EventPopup } from './components/EventPopup';
import { ShipDisplay } from './components/ShipDisplay';
import { ShipModules } from './components/ShipModules';

const INITIAL_RESOURCES = {
  hull: 80,
  energy: 70,
  scrap: 25,
  crew: 12,
  stability: 70,
};

const INITIAL_MODULE_LEVELS = {
  hull_plating: 0,
  capacitor: 0,
  scrap_hold: 0,
  quarters: 0,
  gyro: 0,
};

const RESOURCE_LABELS = {
  hull: 'Корпус',
  energy: 'Энергия',
  scrap: 'Лом',
  crew: 'Экипаж',
  stability: 'Стабильность',
};

function pickRandomEvent() {
  return events[Math.floor(Math.random() * events.length)];
}

function formatDeltaForLog(delta, extra = {}) {
  const combined = { ...delta, ...extra };
  const parts = [];
  Object.entries(combined).forEach(([key, val]) => {
    if (val === 0 || val === undefined) return;
    const label = RESOURCE_LABELS[key] ?? key;
    const sign = val > 0 ? '+' : '';
    parts.push(`${label}: ${sign}${val}`);
  });
  return parts.length > 0 ? ` [${parts.join(', ')}]` : '';
}

export default function App() {
  const [resources, setResources] = useState(INITIAL_RESOURCES);
  const [moduleLevels, setModuleLevels] = useState(INITIAL_MODULE_LEVELS);
  const [turn, setTurn] = useState(0);
  const [eventLog, setEventLog] = useState([]);
  const [currentEvent, setCurrentEvent] = useState(null);
  const [isEventActive, setIsEventActive] = useState(false);
  const [stormProgress, setStormProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  const limits = useMemo(() => getResourceLimits(moduleLevels), [moduleLevels]);

  const isGameOver = resources.hull <= 0 || resources.crew <= 0;
  const isVictory = stormProgress >= 100;

  const handleWait = useCallback(() => {
    if (isEventActive || isGameOver || isVictory) return;

    const roll = Math.random();
    const isFirstClick = turn === 0;
    const gotEvent = isFirstClick || roll < 0.7;

    // Пассивная регенерация энергии +2
    setResources((prev) =>
      applyDeltas(prev, { energy: 2 }, limits)
    );
    setTurn((t) => t + 1);

    if (gotEvent && events.length > 0) {
      const event = pickRandomEvent();
      if (event) {
        setCurrentEvent(event);
        setIsEventActive(true);
      } else {
        setEventLog((prev) => [...prev.slice(-49), '[Ошибка: не удалось выбрать событие]']);
      }
    } else {
      const calmDelta = formatDeltaForLog({ energy: 2 });
      setEventLog((prev) => [
        ...prev.slice(-49),
        (gotEvent ? '[Ошибка: нет событий]' : 'В буре затишье. Системы стабильны.') + calmDelta,
      ]);
    }
  }, [isEventActive, isGameOver, isVictory, limits, turn]);

  const handleChoice = useCallback(
    (choiceIndex) => {
      if (!currentEvent || isProcessing) return;
      const choice = currentEvent.choices[choiceIndex];
      if (!choice) return;

      setIsProcessing(true);

      // Определяем дельту: обычный выбор или риск (chance/success/failure)
      let delta = choice.delta;
      let riskOutcome = null;
      if (choice.chance != null && choice.success != null && choice.failure != null) {
        riskOutcome = Math.random() < choice.chance ? 'success' : 'failure';
        delta = riskOutcome === 'success' ? choice.success : choice.failure;
      }
      delta = delta ?? {};

      // Множитель сложности: при stormProgress > 50 урон +20%
      const difficultyMultiplier = stormProgress > 50 ? 1.2 : 1;
      const finalDelta = applyDifficultyToDeltas(delta, difficultyMultiplier);

      // Применяем последствия и регенерацию энергии
      const afterChoice = applyDeltas(resources, finalDelta, limits);
      const afterRegen = applyDeltas(
        afterChoice,
        { energy: ENERGY_REGEN_PER_TURN },
        limits
      );
      setResources(afterRegen);

      // Прогресс бури: +2..5
      const stormGain = 2 + Math.floor(Math.random() * 4);
      setStormProgress((p) => Math.min(100, p + stormGain));

      const riskSuffix = riskOutcome ? ` (${riskOutcome === 'success' ? 'успех' : 'провал'})` : '';
      const deltaStr = formatDeltaForLog(finalDelta, { energy: ENERGY_REGEN_PER_TURN });
      const stormStr = stormGain > 0 ? ` | Буря: +${stormGain}%` : '';
      setEventLog((prev) => [
        ...prev.slice(-49),
        `Ход ${turn + 1}: ${currentEvent.title} → "${choice.text}"${riskSuffix}${deltaStr}${stormStr}`,
      ]);

      setTurn((t) => t + 1);
      setCurrentEvent(null);
      setIsEventActive(false);
      setIsProcessing(false);
    },
    [currentEvent, isProcessing, limits, resources, stormProgress, turn]
  );

  const handleUpgrade = useCallback(
    (moduleId) => {
      const mod = SHIP_MODULES.find((m) => m.id === moduleId);
      if (!mod) return;
      const level = moduleLevels[moduleId] ?? 0;
      if (level >= mod.maxLevel || resources.scrap < mod.cost) return;
      setModuleLevels((prev) => ({ ...prev, [moduleId]: level + 1 }));
      setResources((prev) => ({ ...prev, scrap: prev.scrap - mod.cost }));
      const upgradeDelta = formatDeltaForLog({ scrap: -mod.cost });
      setEventLog((prev) => [...prev.slice(-49), `Улучшение: ${mod.name} до уровня ${level + 1}.${upgradeDelta}`]);
    },
    [moduleLevels, resources.scrap]
  );

  const handleRestart = useCallback(() => {
    setResources(INITIAL_RESOURCES);
    setModuleLevels(INITIAL_MODULE_LEVELS);
    setTurn(0);
    setEventLog([]);
    setCurrentEvent(null);
    setIsEventActive(false);
    setStormProgress(0);
    setIsProcessing(false);
  }, []);

  // Экран поражения
  if (isGameOver) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono flex flex-col items-center justify-center p-8">
        <h2 className="text-2xl font-bold text-red-500 mb-4">Корабль потерян в пустоте</h2>
        <p className="text-zinc-400 mb-6 text-center">
          Hull: {resources.hull} | Crew: {resources.crew}
        </p>
        <button
          type="button"
          onClick={handleRestart}
          className="px-8 py-3 rounded border-2 border-amber-600 bg-amber-900/50 hover:bg-amber-800/50 text-amber-400 font-semibold transition-colors"
        >
          НАЧАТЬ ЗАНОВО
        </button>
      </div>
    );
  }

  // Экран победы
  if (isVictory) {
    return (
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
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-300 font-mono p-4">
      <header className="mb-4 border-b-2 border-zinc-700 pb-2">
        <h1 className="text-xl font-bold text-amber-500/90 tracking-wider">
          LOST SHIP
        </h1>
        <p className="text-xs text-zinc-500">Ход: {turn}</p>
      </header>

      {/* Прогресс бури */}
      <div className="mb-4 terminal-panel p-3">
        <div className="text-cyan-500/90 text-sm font-semibold mb-2">
          Стабильность пространственного ядра
        </div>
        <div className="h-4 bg-zinc-800 rounded overflow-hidden border border-zinc-600">
          <div
            className="h-full bg-gradient-to-r from-cyan-700 to-emerald-600 transition-all duration-300"
            style={{ width: `${stormProgress}%` }}
          />
        </div>
        <p className="text-xs text-zinc-500 mt-1 tabular-nums">{stormProgress}%</p>
      </div>

      {/* Корабль в космосе */}
      <ShipDisplay />

      {/* Верхняя панель ресурсов */}
      <div className="mb-4">
        <ResourcePanel resources={resources} limits={limits} />
      </div>

      {/* Кнопка ЖДАТЬ */}
      <div className="mb-4 flex justify-center">
        <button
          type="button"
          disabled={isEventActive}
          onClick={handleWait}
          className="px-12 py-4 rounded-lg border-2 border-amber-600 bg-amber-900/30 font-bold text-amber-400 text-lg tracking-wider hover:bg-amber-800/40 hover:border-amber-500 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-900/30 transition-colors"
        >
          {isEventActive ? 'ОЖИДАНИЕ РЕШЕНИЯ...' : 'СКАНИРОВАТЬ ГОРИЗОНТ'}
        </button>
      </div>

      {/* Попап события — перекрывает экран, когда есть активное событие */}
      <EventPopup
        event={currentEvent}
        onChoice={handleChoice}
        disabled={isProcessing}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <EventLog entries={eventLog} />
        </div>
        <div>
          <ShipModules
            moduleLevels={moduleLevels}
            scrap={resources.scrap}
            onUpgrade={handleUpgrade}
          />
        </div>
      </div>
    </div>
  );
}
