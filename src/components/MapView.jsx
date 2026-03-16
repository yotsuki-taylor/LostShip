import React from 'react';
import { NODE_STATUS, getNodeStatus, getReachableNodeIds } from '../utils/mapUtils';

const NODE_RADIUS = 24;
const PADDING = 80;

/**
 * Отрисовка карты: узлы и связи.
 * @param {object} mapState - { nodes, edges, currentNodeId, visitedIds }
 * @param {function} onNodeClick - (nodeId) => void
 */
export function MapView({ mapState, onNodeClick }) {
  if (!mapState?.nodes?.length) return null;

  const { nodes, edges, currentNodeId, visitedIds } = mapState;
  const reachableIds = getReachableNodeIds(currentNodeId, mapState.edges ?? []);

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
        {(mapState.edges ?? []).map(([fromId, toId], i) => {
          const from = nodes.find((n) => n.id === fromId);
          const to = nodes.find((n) => n.id === toId);
          if (!from || !to) return null;
          const x1 = scaleX(from.x);
          const y1 = scaleY(from.y);
          const x2 = scaleX(to.x);
          const y2 = scaleY(to.y);
          const fromVisited = visitedIds?.has(fromId) || fromId === currentNodeId;
          const toVisited = visitedIds?.has(toId);
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
        const status = getNodeStatus(node.id, currentNodeId, visitedIds ?? new Set(), reachableIds);
        const cx = scaleX(node.x);
        const cy = scaleY(node.y);
        const isClickable = status === NODE_STATUS.REACHABLE || (status === NODE_STATUS.VISITED && reachableIds.has(node.id));

        let fill = 'rgb(63, 63, 70)';
        let stroke = 'rgb(113, 113, 122)';
        let r = NODE_RADIUS;
        const isReturnToVisited = status === NODE_STATUS.VISITED && reachableIds.has(node.id);

        if (status === NODE_STATUS.CURRENT) {
          fill = 'rgb(251, 191, 36)';
          stroke = 'rgb(245, 158, 11)';
          r = NODE_RADIUS + 2;
        } else if (status === NODE_STATUS.REACHABLE) {
          fill = 'rgba(251, 191, 36, 0.4)';
          stroke = 'rgb(251, 191, 36)';
        } else if (status === NODE_STATUS.VISITED) {
          fill = 'rgba(34, 197, 94, 0.5)';
          stroke = isReturnToVisited ? 'rgb(251, 191, 36)' : 'rgb(34, 197, 94)';
        }

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
              <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="rgba(251, 191, 36, 0.5)" strokeWidth="2" className="animate-pulse" />
            )}
          </g>
        );
      })}
    </svg>
  );
}
