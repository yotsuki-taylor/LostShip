import React, { useEffect } from 'react';

/** Координаты звёзд (x%, y%) и размер (1–2) */
const STARS = [
  [5, 12, 1], [15, 8, 2], [25, 22, 1], [35, 5, 1], [45, 18, 2], [55, 3, 1], [65, 25, 1], [75, 10, 2], [85, 28, 1], [92, 15, 1],
  [8, 28, 1], [22, 14, 1], [38, 30, 2], [52, 7, 1], [68, 20, 1], [82, 5, 1], [12, 5, 2], [30, 26, 1], [48, 12, 1], [70, 8, 2],
  [18, 32, 1], [42, 2, 1], [58, 24, 1], [78, 18, 1], [3, 20, 1], [28, 10, 2], [62, 14, 1], [88, 22, 1],
];

const WARP_DURATION_MS = 1000;

/**
 * Блок с чёрным космосом и анимированным кораблём.
 * Размещается под стабильностью ядра и над ресурсами.
 * @param {boolean} isWarping - если true, показывается варп-анимация вместо bob
 * @param {function} onWarpEnd - вызывается по завершении варп-анимации
 */
export function ShipDisplay({ isWarping = false, onWarpEnd }) {
  useEffect(() => {
    if (!isWarping || !onWarpEnd) return;
    const t = setTimeout(onWarpEnd, WARP_DURATION_MS);
    return () => clearTimeout(t);
  }, [isWarping, onWarpEnd]);

  return (
    <div className="mb-4 relative overflow-hidden rounded-lg border-2 border-zinc-600 h-32 bg-black">
      {/* Чёрный космос */}
      <div className="absolute inset-0 bg-black" aria-hidden="true" />

      {/* Звёзды */}
      <div className="absolute inset-0" aria-hidden="true">
        {STARS.map(([x, y, size], i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              opacity: size === 2 ? 0.9 : 0.6,
            }}
          />
        ))}
      </div>

      {/* Корабль: варп или bob */}
      <div className="absolute inset-0 flex items-center justify-center">
        {isWarping && (
          <>
            <div
              className="absolute w-24 h-24 rounded-full animate-warp-flash"
              style={{
                background: 'radial-gradient(circle, rgba(34,211,238,0.9) 0%, rgba(34,211,238,0.4) 30%, transparent 70%)',
                boxShadow: '0 0 60px 20px rgba(34,211,238,0.5)',
              }}
              aria-hidden="true"
            />
            {[...Array(12)].map((_, i) => {
              const angle = (i / 12) * Math.PI * 2;
              const dist = 45;
              const px = Math.cos(angle) * dist;
              const py = Math.sin(angle) * dist;
              return (
                <div
                  key={i}
                  className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/90 animate-warp-particle"
                  style={{
                    '--px': `${px}px`,
                    '--py': `${py}px`,
                    animationDelay: `${i * 25}ms`,
                  }}
                  aria-hidden="true"
                />
              );
            })}
          </>
        )}
        <img
          src={`${import.meta.env.BASE_URL}images/ship.png`}
          alt="Корабль"
          className={`h-20 w-auto object-contain relative z-10 ${isWarping ? 'animate-ship-warp' : 'animate-ship-bob'}`}
        />
      </div>
    </div>
  );
}
