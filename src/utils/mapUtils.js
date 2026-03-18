/**
 * Система карты в стиле FTL.
 * Граф узлов с прогрессией слева направо.
 */

export const NODE_STATUS = {
  UNVISITED: 'unvisited',
  CURRENT: 'current',
  VISITED: 'visited',
  REACHABLE: 'reachable',
};

/** Типы нод: определяется при входе на ноду */
export const NODE_TYPE = {
  COMBAT: 'combat',
  STORY: 'story',
  RANDOM: 'random',
  TRADE: 'trade',
};

/** Шансы: 25% бой, 25% сюжет, 50% рандом, 0% торговля */
const NODE_TYPE_CHANCES = [
  { type: NODE_TYPE.COMBAT, chance: 0.25 },
  { type: NODE_TYPE.STORY, chance: 0.25 },
  { type: NODE_TYPE.RANDOM, chance: 0.5 },
  { type: NODE_TYPE.TRADE, chance: 0 },
];

export function rollNodeType() {
  const r = Math.random();
  let acc = 0;
  for (const { type, chance } of NODE_TYPE_CHANCES) {
    acc += chance;
    if (r < acc) return type;
  }
  return NODE_TYPE.RANDOM;
}

/** Количество колонок (прогрессия слева направо) */
const MAP_COLUMNS = 8;

/** Минимум/максимум узлов в колонке (кроме первой) */
const MIN_NODES_PER_COL = 1;
const MAX_NODES_PER_COL = 3;

/** Минимум/максимум исходящих связей от узла к следующей колонке */
const MIN_OUT_EDGES = 2;
const MAX_OUT_EDGES = 3;

/**
 * Генерирует карту: массив узлов и рёбер.
 * Узлы имеют координаты (x, y) в диапазоне 0–1 для отрисовки.
 * @returns {{ nodes: Array<{id: number, x: number, y: number}>, edges: Array<[number, number]> }}
 */
export function generateMapGraph() {
  const nodes = [];
  const edges = [];
  let nodeId = 0;

  // Первая колонка — стартовая точка
  nodes.push({ id: nodeId++, x: 0, y: 0.5 });

  let prevColNodes = [0];

  const lastCol = MAP_COLUMNS - 1;
  for (let col = 1; col < MAP_COLUMNS; col++) {
    const isLastCol = col === lastCol;
    const count = isLastCol ? 1 : MIN_NODES_PER_COL + Math.floor(Math.random() * (MAX_NODES_PER_COL - MIN_NODES_PER_COL + 1));

    const thisColNodes = [];
    const step = 1 / (count + 1);
    for (let i = 0; i < count; i++) {
      const y = step * (i + 1);
      const isExit = isLastCol;
      nodes.push({ id: nodeId, x: col / (MAP_COLUMNS - 1), y, ...(isExit && { isExit: true }) });
      thisColNodes.push(nodeId);
      nodeId++;
    }

    // Связи: каждый узел предыдущей колонки соединяется с 2–3 узлами текущей
    prevColNodes.forEach((fromId) => {
      const numTargets = Math.min(
        count,
        MIN_OUT_EDGES + Math.floor(Math.random() * (MAX_OUT_EDGES - MIN_OUT_EDGES + 1))
      );
      const shuffled = [...thisColNodes].sort(() => Math.random() - 0.5);
      const targets = shuffled.slice(0, numTargets);
      targets.forEach((toId) => edges.push([fromId, toId]));
    });

    // Каждый узел текущей колонки должен иметь хотя бы одно входящее ребро
    thisColNodes.forEach((toId) => {
      const hasIncoming = edges.some(([, to]) => to === toId);
      if (!hasIncoming && prevColNodes.length > 0) {
        const fromId = prevColNodes[Math.floor(Math.random() * prevColNodes.length)];
        if (!edges.some(([a, b]) => a === fromId && b === toId)) {
          edges.push([fromId, toId]);
        }
      }
    });

    prevColNodes = thisColNodes;
  }

  const exitId = nodes.find((n) => n.isExit)?.id;

  // Обратные рёбра: можно возвращаться на посещённые узлы
  const edgeSet = new Set(edges.map(([a, b]) => `${a}-${b}`));
  [...edges].forEach(([from, to]) => {
    if (to === exitId) return; // не возвращаться с выхода
    if (!edgeSet.has(`${to}-${from}`)) {
      edges.push([to, from]);
      edgeSet.add(`${to}-${from}`);
    }
  });

  // Гарантия: у каждого узла (кроме выхода) есть хотя бы одно исходящее ребро
  nodes.forEach((node) => {
    if (node.isExit) return;
    const hasOutgoing = edges.some(([from]) => from === node.id);
    if (!hasOutgoing) {
      const nextNodes = nodes.filter((n) => n.x > node.x && !n.isExit).sort((a, b) => a.x - b.x);
      const fallback = nextNodes.length > 0 ? nextNodes[0] : nodes.find((n) => n.isExit);
      if (fallback && !edgeSet.has(`${node.id}-${fallback.id}`)) {
        edges.push([node.id, fallback.id]);
        edgeSet.add(`${node.id}-${fallback.id}`);
      }
    }
  });

  return { nodes, edges };
}

/** Проверяет, является ли узел финальным (выход) */
export function isExitNode(nodes, nodeId) {
  const node = nodes?.find((n) => n.id === nodeId);
  return node?.isExit === true;
}

/**
 * Возвращает статус узла.
 * @param {number} nodeId
 * @param {number} currentNodeId
 * @param {Set<number>} visitedIds
 * @param {Set<number>} reachableIds
 */
export function getNodeStatus(nodeId, currentNodeId, visitedIds, reachableIds) {
  if (nodeId === currentNodeId) return NODE_STATUS.CURRENT;
  if (visitedIds.has(nodeId)) return NODE_STATUS.VISITED;
  if (reachableIds.has(nodeId)) return NODE_STATUS.REACHABLE;
  return NODE_STATUS.UNVISITED;
}

/**
 * Возвращает множество ID узлов, достижимых из текущего по рёбрам.
 * @param {number} currentNodeId
 * @param {Array<[number, number]>} edges
 */
export function getReachableNodeIds(currentNodeId, edges) {
  const reachable = new Set();
  edges.forEach(([from, to]) => {
    if (from === currentNodeId) reachable.add(to);
  });
  return reachable;
}

/**
 * Создаёт начальное состояние карты для новой игры.
 * Один узел (кроме старта и выхода) назначается рынком.
 */
export function createInitialMapState() {
  const { nodes, edges } = generateMapGraph();
  const marketCandidates = nodes.filter((n) => n.id !== 0 && !n.isExit);
  const marketNode = marketCandidates[Math.floor(Math.random() * marketCandidates.length)];
  const nodeTypes = marketNode ? { [marketNode.id]: NODE_TYPE.TRADE } : {};
  return {
    nodes,
    edges,
    currentNodeId: 0,
    visitedIds: new Set(),
    nodeTypes,
  };
}

/**
 * Сериализует состояние карты для сохранения.
 * @param {{ nodes: Array, edges: Array, currentNodeId: number, visitedIds: Set }}
 */
export function serializeMapState(mapState) {
  if (!mapState) return null;
  return {
    nodes: mapState.nodes,
    edges: mapState.edges,
    currentNodeId: mapState.currentNodeId,
    visitedIds: Array.from(mapState.visitedIds ?? []),
    nodeTypes: mapState.nodeTypes ?? {},
  };
}

/**
 * Добавляет обратные рёбра для возврата на посещённые узлы (миграция для старых сохранений).
 */
export function ensureBidirectionalEdges(nodes, edges) {
  const exitNode = nodes.find((n) => n.isExit);
  const exitId = exitNode?.id;
  const edgeSet = new Set(edges.map(([a, b]) => `${a}-${b}`));
  const result = [...edges];
  edges.forEach(([from, to]) => {
    if (exitId != null && to === exitId) return;
    if (!edgeSet.has(`${to}-${from}`)) {
      result.push([to, from]);
      edgeSet.add(`${to}-${from}`);
    }
  });
  return result;
}

/**
 * Восстанавливает отсутствующие исходящие рёбра у узлов (миграция для старых сохранений).
 */
function ensureAllNodesHaveOutgoingEdges(nodes, edges) {
  const exitNode = nodes.find((n) => n.isExit);
  if (!exitNode) return edges;
  const edgeSet = new Set(edges.map(([a, b]) => `${a}-${b}`));
  const result = [...edges];
  nodes.forEach((node) => {
    if (node.isExit) return;
    const hasOutgoing = result.some(([from]) => from === node.id);
    if (!hasOutgoing) {
      const nextNodes = nodes.filter((n) => n.x > node.x && !n.isExit).sort((a, b) => a.x - b.x);
      const fallback = nextNodes.length > 0 ? nextNodes[0] : exitNode;
      if (fallback && !edgeSet.has(`${node.id}-${fallback.id}`)) {
        result.push([node.id, fallback.id]);
        edgeSet.add(`${node.id}-${fallback.id}`);
      }
    }
  });
  return result;
}

/**
 * Восстанавливает состояние карты из сохранения.
 */
export function deserializeMapState(saved) {
  if (!saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) return null;
  let edges = ensureBidirectionalEdges(saved.nodes, saved.edges);
  edges = ensureAllNodesHaveOutgoingEdges(saved.nodes, edges);
  edges = ensureBidirectionalEdges(saved.nodes, edges); // обратные рёбра для добавленных ensureAllNodesHaveOutgoingEdges
  return {
    nodes: saved.nodes,
    edges,
    currentNodeId: saved.currentNodeId ?? 0,
    visitedIds: new Set(saved.visitedIds ?? []),
    nodeTypes: saved.nodeTypes ?? {},
  };
}

/**
 * Выполняет прыжок на целевой узел. Обновляет состояние карты.
 * @param {object} mapState
 * @param {number} targetNodeId
 */
export function performJump(mapState, targetNodeId) {
  const reachable = getReachableNodeIds(mapState.currentNodeId, mapState.edges);
  if (!reachable.has(targetNodeId)) return null;

  const newVisited = new Set(mapState.visitedIds);
  newVisited.add(mapState.currentNodeId);

  const newReachable = getReachableNodeIds(targetNodeId, mapState.edges);

  return {
    ...mapState,
    currentNodeId: targetNodeId,
    visitedIds: newVisited,
    reachableIds: newReachable,
    nodeTypes: mapState.nodeTypes ?? {},
  };
}
