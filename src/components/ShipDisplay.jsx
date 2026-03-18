import React, { useEffect } from 'react';

/** Координаты звёзд (x%, y%) и размер (1–2) */
const STARS = [
  [5, 12, 1], [15, 8, 2], [25, 22, 1], [35, 5, 1], [45, 18, 2], [55, 3, 1], [65, 25, 1], [75, 10, 2], [85, 28, 1], [92, 15, 1],
  [8, 28, 1], [22, 14, 1], [38, 30, 2], [52, 7, 1], [68, 20, 1], [82, 5, 1], [12, 5, 2], [30, 26, 1], [48, 12, 1], [70, 8, 2],
  [18, 32, 1], [42, 2, 1], [58, 24, 1], [78, 18, 1], [3, 20, 1], [28, 10, 2], [62, 14, 1], [88, 22, 1],
];

const WARP_DURATION_MS = 1000;

/** Смещения для разброса партиклов (px от центра). Сдвиг вниз — по корпусу, не по парусам */
const DAMAGE_OFFSET_Y = 14;
const DAMAGE_OFFSETS = [[-10, 6], [8, -8], [-6, -10]];

/** Эффект получения урона — три партикла damage.png по очереди с наложением, поверх корабля */
function DamageParticles({ trigger }) {
  if (!trigger) return null;
  const damageImg = `${import.meta.env.BASE_URL}images/damage.png`;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20" aria-hidden="true">
      {[0, 1, 2].map((i) => {
        const [dx, dy] = DAMAGE_OFFSETS[i];
        return (
          <img
            key={`${trigger}-${i}`}
            src={damageImg}
            alt=""
            className="absolute left-1/2 top-1/2 w-12 h-12 -translate-x-1/2 -translate-y-1/2 object-contain animate-damage-particle"
            style={{
              animationDelay: `${i * 120}ms`,
              left: `calc(50% + ${dx}px)`,
              top: `calc(50% + ${DAMAGE_OFFSET_Y + dy}px)`,
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * Блок с чёрным космосом и анимированным кораблём.
 * Размещается под стабильностью ядра и над ресурсами.
 * @param {boolean} isWarping - если true, показывается варп-анимация вместо bob
 * @param {function} onWarpEnd - вызывается по завершении варп-анимации
 * @param {object} enemy - { icon, name, hp, maxHp? } — враг справа при бое
 * @param {number} playerHitTrigger - инкрементируется при получении урона игроком
 * @param {number} enemyHitTrigger - инкрементируется при нанесении урона врагу
 */
export function ShipDisplay({ isWarping = false, onWarpEnd, enemy, playerHitTrigger = 0, enemyHitTrigger = 0 }) {
  useEffect(() => {
    if (!isWarping || !onWarpEnd) return;
    const t = setTimeout(onWarpEnd, WARP_DURATION_MS);
    return () => clearTimeout(t);
  }, [isWarping, onWarpEnd]);

  return (
    <div className="mb-2 relative overflow-hidden rounded-lg border-2 border-zinc-600 h-32 bg-black">
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

      {/* Корабль и враг: варп или bob. В бою — игрок слева, враг справа; иначе — игрок по центру */}
      <div className={`absolute inset-0 flex items-center px-4 ${enemy ? 'justify-between' : 'justify-center'}`}>
        {enemy ? (
          <>
            <div className="flex-1 flex items-center justify-center relative">
              <DamageParticles trigger={playerHitTrigger} />
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
            <div className="flex-1 flex items-center justify-center relative">
              <DamageParticles trigger={enemyHitTrigger} />
              <div className="flex flex-col items-center">
                <img
                  src={(() => {
                    const icon = enemy.icon?.trim();
                    if (!icon) return `${import.meta.env.BASE_URL}images/enemy.png`;
                    if (icon.startsWith('http')) return icon;
                    const path = icon.includes('/') ? icon : `images/${icon}${icon.includes('.') ? '' : '.png'}`;
                    return `${import.meta.env.BASE_URL}${path}`;
                  })()}
                  alt={enemy.name || 'Враг'}
                  className="h-20 w-auto object-contain animate-ship-bob"
                  onError={(e) => {
                    e.target.style.display = 'none';
                  }}
                />
                {enemy.hp != null && (
                  <div className="mt-1 w-20">
                    <div className="h-2 bg-zinc-700 rounded overflow-hidden border border-zinc-600">
                      <div
                        className="h-full bg-red-500 transition-all duration-300"
                        style={{
                          width: `${Math.min(100, Math.max(0, (enemy.hp / ((enemy.maxHp ?? enemy.hp) || 1)) * 100))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center relative">
            <DamageParticles trigger={playerHitTrigger} />
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
        )}
      </div>
    </div>
  );
}
