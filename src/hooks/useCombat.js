import { useState, useRef, useEffect, useCallback } from 'react';
import { applyDeltas } from '../utils/resourceHelpers';
import { applyTeamXpReward, getCombatAttackBonus } from '../utils/crewXp';
import {
  FLEE_COST,
  FLEE_BUTTON_COST_TEXT,
  rollNd6,
  isDemonSubordinate,
  distributeHullDamageToCrew,
  applyAccumulatedCombatHullDamageToCrew,
} from '../utils/combatHelpers';
import { formatDeltaForLog } from '../utils/formatHelpers';
import { pickCriticalEvent } from '../services/sheetLoader';
import { serializeMapState } from '../utils/mapUtils';
import { saveGame } from '../utils/saveGame';

export function useCombat({
  resources, setResources,
  gameCrew, setGameCrew,
  playerVars, setPlayerVars,
  eventLog, setEventLog,
  turn, mapState, nextDestByDestination, shownEventIds,
  limits, fights, crew, events,
  findEventByIdOrTitle, getCriticalResource,
  isProcessing, setIsProcessing,
  setCurrentEvent, setCurrentCriticalResource,
}) {
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
  const combatCrewHullDamageAccumRef = useRef(0);

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

  const startCombat = useCallback((fightData, { logEntry, initialEnemyHp } = {}) => {
    const startEvent = fightData.eventStart ? findEventByIdOrTitle(fightData.eventStart) : null;
    const hp = initialEnemyHp !== undefined ? initialEnemyHp : Math.max(0, fightData.hp ?? 0);
    combatCrewHullDamageAccumRef.current = 0;
    setEnemyHitTrigger(0);
    setCurrentFight(fightData);
    setCombatTurn(startEvent ? 0 : 1);
    setEnemyHp(hp);
    setCombatEvent(startEvent || null);
    if (logEntry) {
      setEventLog((prev) => [...prev.slice(-5), logEntry].slice(-5));
    }
  }, [findEventByIdOrTitle, setEventLog]);

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
  }, [setPlayerVars, setEventLog]);

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
    [currentFight, enemyHp, resources, combatTurn, eventLog, mapState, playerVars, turn, nextDestByDestination, shownEventIds, findEventByIdOrTitle, finishCombat, gameCrew, limits, crew, setResources, setGameCrew, setEventLog, setPlayerVars]
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
      setIsProcessing,
      setResources,
      setGameCrew,
      setPlayerVars,
      setEventLog,
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
              setPendingFightEnd({ win: won, endEvent: won ? findEventByIdOrTitle(currentFight?.endFightEvent) : null });
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
    [combatEvent, pendingFightEnd, pendingCombatAction, limits, finishCombat, gameCrew, resources, enemyHp, combatTurn, eventLog, currentFight, findEventByIdOrTitle, mapState, playerVars, turn, nextDestByDestination, shownEventIds, crew, events, getCriticalResource, setResources, setGameCrew, setPlayerVars, setEventLog, setCurrentEvent, setCurrentCriticalResource]
  );

  return {
    currentFight,
    setCurrentFight,
    combatTurn,
    setCombatTurn,
    enemyHp,
    setEnemyHp,
    combatEvent,
    setCombatEvent,
    pendingFightEnd,
    setPendingFightEnd,
    pendingCombatAction,
    setPendingCombatAction,
    playerHitTrigger,
    setPlayerHitTrigger,
    enemyHitTrigger,
    setEnemyHitTrigger,
    ramTrigger,
    setRamTrigger,
    screenShake,
    ramShake,
    combatCrewHullDamageAccumRef,
    startCombat,
    finishCombat,
    runCombatTurn,
    handleCombatAction,
    handleCombatEventChoice,
    FLEE_BUTTON_COST_TEXT,
  };
}
