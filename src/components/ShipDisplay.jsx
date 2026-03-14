import React from 'react';

/** Координаты звёзд (x%, y%) и размер (1–2) */
const STARS = [
  [5, 12, 1], [15, 8, 2], [25, 22, 1], [35, 5, 1], [45, 18, 2], [55, 3, 1], [65, 25, 1], [75, 10, 2], [85, 28, 1], [92, 15, 1],
  [8, 28, 1], [22, 14, 1], [38, 30, 2], [52, 7, 1], [68, 20, 1], [82, 5, 1], [12, 5, 2], [30, 26, 1], [48, 12, 1], [70, 8, 2],
  [18, 32, 1], [42, 2, 1], [58, 24, 1], [78, 18, 1], [3, 20, 1], [28, 10, 2], [62, 14, 1], [88, 22, 1],
];

/**
 * Блок с чёрным космосом и анимированным кораблём.
 * Размещается под стабильностью ядра и над ресурсами.
 */
export function ShipDisplay() {
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

      {/* Корабль с анимацией вверх-вниз */}
      <div className="absolute inset-0 flex items-center justify-center">
        <img
          src={`${import.meta.env.BASE_URL}images/ship.png`}
          alt="Корабль"
          className="h-20 w-auto object-contain animate-ship-bob"
        />
      </div>
    </div>
  );
}
