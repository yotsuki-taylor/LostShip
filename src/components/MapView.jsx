import React from 'react';
import { NODE_STATUS, NODE_TYPE, getNodeStatus, getReachableNodeIds, ensureBidirectionalEdges } from '../utils/mapUtils';

const NODE_RADIUS = 24;
const ICON_SIZE = 40;

const NODE_TYPE_ICONS = {
  [NODE_TYPE.COMBAT]: 'map_icon_battle',
  [NODE_TYPE.STORY]: 'map_icon_story',
  [NODE_TYPE.RANDOM]: 'map_icon_random',
  [NODE_TYPE.TRADE]: 'map_icon_market',
};
const PADDING = 80;

/**
 * Отрисовка карты: узлы и связи.
 * @param {object} mapState - { nodes, edges, currentNodeId, visitedIds }
 * @param {function} onNodeClick - (nodeId) => void
 */
export function MapView({ mapState, onNodeClick }) {
  if (!mapState?.nodes?.length) return null;

  const { nodes, edges, currentNodeId, visitedIds, nodeTypes = {} } = mapState;
  const visitedSet = visitedIds instanceof Set ? visitedIds : new Set(visitedIds ?? []);
  const edgesBidi = ensureBidirectionalEdges(nodes, edges ?? []);
  const reachableIds = getReachableNodeIds(currentNodeId, edgesBidi);

  const width = 800;
  const height = 560;
  const scaleX = (v) => PADDING + (width - 2 * PADDING) * v;
  const scaleY = (v) => PADDING + (height - 2 * PADDING) * v;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto max-h-[560px]"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Рёбра: пройденный (но не возможный) — зелёный, возможный (в т.ч. пройденный) — жёлтый */}
      <g strokeWidth="1.5" fill="none">
        {edgesBidi.map(([fromId, toId], i) => {
          const from = nodes.find((n) => n.id === fromId);
          const to = nodes.find((n) => n.id === toId);
          if (!from || !to) return null;
          const x1 = scaleX(from.x);
          const y1 = scaleY(from.y);
          const x2 = scaleX(to.x);
          const y2 = scaleY(to.y);
          const fromVisited = visitedSet.has(fromId) || fromId === currentNodeId;
          const toVisited = visitedSet.has(toId);
          const toReachable = reachableIds.has(toId);
          const isPassedPath = fromVisited && toVisited;
          const isPossiblePath = fromId === currentNodeId && toReachable;
          const stroke = isPossiblePath ? 'rgba(251, 191, 36, 0.7)' : isPassedPath ? 'rgba(34, 197, 94, 0.7)' : 'rgba(113, 113, 122, 0.4)';
          const strokeWidth = (isPassedPath || isPossiblePath) ? 2 : 1;
          return (
            <line
              key={`e-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={stroke}
              strokeWidth={strokeWidth}
            />
          );
        })}
      </g>

      {/* Узлы */}
      {nodes.map((node) => {
        const status = getNodeStatus(node.id, currentNodeId, visitedSet, reachableIds);
        const cx = scaleX(node.x);
        const cy = scaleY(node.y);
        const isClickable = status === NODE_STATUS.REACHABLE || (status === NODE_STATUS.VISITED && reachableIds.has(node.id));

        let fill = 'rgb(63, 63, 70)';
        let stroke = 'rgb(113, 113, 122)';
        let r = NODE_RADIUS;
        const isReturnToVisited = status === NODE_STATUS.VISITED && reachableIds.has(node.id);

        if (status === NODE_STATUS.CURRENT) {
          fill = 'rgb(34, 211, 238)';
          stroke = 'rgb(6, 182, 212)';
          r = NODE_RADIUS + 2;
        } else if (status === NODE_STATUS.REACHABLE) {
          fill = 'rgba(251, 191, 36, 0.4)';
          stroke = 'rgb(251, 191, 36)';
        } else if (status === NODE_STATUS.VISITED) {
          fill = 'rgba(34, 197, 94, 0.5)';
          stroke = isReturnToVisited ? 'rgb(251, 191, 36)' : 'rgb(34, 197, 94)';
        }

        const isExplored = status === NODE_STATUS.VISITED || status === NODE_STATUS.CURRENT;
        const nodeType = nodeTypes[node.id];
        const iconName = nodeType && NODE_TYPE_ICONS[nodeType];
        const iconSrc = iconName ? `${import.meta.env.BASE_URL}images/${iconName}.png` : null;
        const showIcon = isExplored && iconSrc;

        return (
          <g key={node.id}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={fill}
              stroke={stroke}
              strokeWidth={2}
              strokeDasharray={isClickable ? '4 2' : undefined}
              className={isClickable ? 'cursor-pointer hover:opacity-90 transition-opacity' : 'cursor-default'}
              onClick={() => isClickable && onNodeClick?.(node.id)}
              role={isClickable ? 'button' : undefined}
              aria-label={status === NODE_STATUS.CURRENT ? 'Текущая позиция' : status === NODE_STATUS.REACHABLE ? `Прыгнуть к узлу ${node.id}` : undefined}
            />
            {status === NODE_STATUS.CURRENT && (
              <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="rgba(34, 211, 238, 0.5)" strokeWidth="2" className="animate-pulse" pointerEvents="none" />
            )}
            {showIcon && iconSrc && (
              <image
                href={iconSrc}
                x={cx - ICON_SIZE / 2}
                y={cy - ICON_SIZE / 2}
                width={ICON_SIZE}
                height={ICON_SIZE}
                preserveAspectRatio="xMidYMid meet"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
