import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { applyDeltas } from '../utils/resourceHelpers';
import {
  createInitialMapState,
  performJump,
  serializeMapState,
  isExitNode,
  NODE_TYPE,
  rollNodeType,
  ensureSurveyRevealTypes,
} from '../utils/mapUtils';
import { DEFAULT_SHIP_STATS } from '../services/sheetLoader';
import { pickCriticalEvent } from '../services/sheetLoader';
import { saveGame } from '../utils/saveGame';
import {
  applyPassiveCrewEffects,
  buildJumpSuppliesCost,
  distributeHullDamageToCrew,
} from '../utils/combatHelpers';
import { formatDeltaForLog } from '../utils/formatHelpers';

export function useNavigation({
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
  mapState, setMapState,
}) {
  const [isWarping, setIsWarping] = useState(false);
  const pendingJumpRef = useRef(null);

  const mapSurvey = useMemo(
    () => Math.max(0, Math.floor(Number(resources?.survey ?? DEFAULT_SHIP_STATS.survey ?? 0))),
    [resources?.survey]
  );

  useEffect(() => {
    if (!mapState) return;
    if (mapSurvey <= 0) return;
    const next = ensureSurveyRevealTypes(mapState, mapSurvey);
    if (next !== mapState) setMapState(next);
  }, [mapState, mapSurvey, setMapState]);

  const handleMapNodeClick = useCallback(
    (targetNodeId) => {
      if (isEventActive || isGameOver || isVictory || currentFight || !mapState) return;
      pendingJumpRef.current = targetNodeId;
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
        startCombat(fightData, { initialEnemyHp });
        setCurrentEvent(null);
        setIsEventActive(false);
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
  }, [mapState, setMapState, gameCrew, resources, limits, turn, playerVars, events, fights, pickStoryEvent, pickRandomEvent, pickMarketEvent, isDestinationEvent, nextDestByDestination, shownEventIds, getEventKey, eventLog, currentFight, combatTurn, enemyHp, findEventByIdOrTitle, getCriticalResource, criticalPenalties, setResources, setGameCrew, setEventLog, setCurrentEvent, setIsEventActive, setCurrentCriticalResource, setNextDestByDestination, setShownEventIds, startCombat]);

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
        startCombat(fightData, { initialEnemyHp });
        setCurrentEvent(null);
        setIsEventActive(false);
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
  }, [mapState, setMapState, gameCrew, resources, limits, turn, playerVars, events, fights, pickStoryEvent, pickRandomEvent, pickMarketEvent, isDestinationEvent, nextDestByDestination, shownEventIds, getEventKey, eventLog, currentFight, combatTurn, enemyHp, findEventByIdOrTitle, getCriticalResource, criticalPenalties, isEventActive, isGameOver, isVictory, setResources, setGameCrew, setEventLog, setCurrentEvent, setIsEventActive, setCurrentCriticalResource, setNextDestByDestination, setShownEventIds, startCombat]);

  return { isWarping, mapSurvey, handleMapNodeClick, handleWarpEnd, handleClusterTransition };
}
