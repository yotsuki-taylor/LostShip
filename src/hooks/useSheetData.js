import { useState, useEffect, useCallback } from 'react';
import { fetchSheetData, fetchShipStats, fetchCrew, fetchFights, DEFAULT_SHIP_STATS } from '../services/sheetLoader';
import eventsJson from '../data/events.json';
import fightsJson from '../data/fights.json';
import { normalizeEvents } from '../data/events';

const REFRESH_INTERVAL_MS = 30000; // обновление каждые 30 сек

/** Выводит setVariable из текста кнопки, если в таблице не задан opt_consequences */
function inferSetVariableFromText(text) {
  const t = (text || '').toLowerCase().trim();
  if (/торгов|merchant/.test(t)) return { ship: 'merchant' };
  if (/эсмин|destroyer/.test(t)) return { ship: 'destroyer' };
  if (/учёный|ученый|scientist/.test(t)) return { guest: 'scientist' };
  if (/воин|warrior/.test(t)) return { guest: 'warrior' };
  if (/демон|demon|поиски демона/.test(t)) return { dest: 'demon' };
  if (/маяк|lighthouse|планарный/.test(t)) return { dest: 'lighthouse' };
  if (/рынок|market|мир-рынок/.test(t)) return { dest: 'market' };
  return null;
}

/** Интро по умолчанию, когда таблица не даёт варианты выбора */
const DEFAULT_INTRO_SLIDES = [
  {
    title: 'Тип корабля',
    text: 'Какой корабль ведёте вы через бурю?',
    choices: [
      { text: 'Торговец', setVariable: { ship: 'merchant' }, delta: { speed: 1, supplies: 5 } },
      { text: 'Эсминец', setVariable: { ship: 'destroyer' }, delta: { speed: 2, attack: 1 } },
    ],
  },
  {
    title: 'Попутчик',
    text: 'Кто сопровождает вас в этом рейсе?',
    choices: [
      { text: 'Учёный', setVariable: { guest: 'scientist' }, delta: { energy: 5 } },
      { text: 'Воин', setVariable: { guest: 'warrior' }, delta: { attack: 1 } },
    ],
  },
  {
    title: 'Цель',
    text: 'Куда держите курс?',
    choices: [
      { text: 'Маяк', setVariable: { dest: 'lighthouse' }, delta: { supplies: 3 } },
      { text: 'Рынок', setVariable: { dest: 'market' }, delta: { supplies: 5 } },
    ],
  },
  {
    title: 'В путь',
    text: 'Буря ждёт. Удачи, капитан.',
    choices: [{ text: 'Выходить', setVariable: null, delta: null }],
  },
];

export function useSheetData() {
  const [sheetData, setSheetData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [data, shipStats, crew, fights] = await Promise.all([
        fetchSheetData(),
        fetchShipStats(),
        fetchCrew(),
        fetchFights().catch(() => []),
      ]);
      setSheetData((prev) => {
        const preserved = data ?? (prev?.events?.length ? { intro: prev.intro ?? [], events: prev.events } : null);
        const mergedCrew = (crew && crew.length > 0) ? crew : (prev?.crew ?? []);
        const mergedFights = (fights && fights.length > 0) ? fights : (prev?.fights?.length ? prev.fights : fightsJson ?? []);
        return preserved
          ? {
              ...preserved,
              shipStats: shipStats ?? prev?.shipStats ?? DEFAULT_SHIP_STATS,
              crew: mergedCrew,
              fights: mergedFights,
            }
          : {
              shipStats: shipStats ?? DEFAULT_SHIP_STATS,
              crew: mergedCrew,
              fights: mergedFights,
            };
      });
      setError(null);
    } catch (e) {
      setError(e.message);
      // При сетевых сбоях не теряем уже загруженные события из таблицы.
      setSheetData((prev) => prev ?? { shipStats: DEFAULT_SHIP_STATS, crew: [], fights: fightsJson ?? [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const retryId = setTimeout(load, 2500);
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      clearTimeout(retryId);
      clearInterval(id);
    };
  }, [load]);

  const localEvents = normalizeEvents(eventsJson);
  let events = sheetData?.events?.length ? sheetData.events : localEvents;

  // События, на которые ссылаются бои (eventStart, eventTurns, endFightEvent), должны быть в списке
  const fightsList = (sheetData?.fights?.length ? sheetData.fights : fightsJson) ?? [];
  const fightEventRefs = new Set();
  fightsList.forEach((f) => {
    if (f.eventStart) fightEventRefs.add(String(f.eventStart).trim());
    (f.eventTurns || []).forEach((t) => t && fightEventRefs.add(String(t).trim()));
    if (f.endFightEvent) fightEventRefs.add(String(f.endFightEvent).trim());
  });
  const findInEvents = (e, ref) =>
    String(e.id) === ref || (e.event || '').trim() === ref || (e.title || '').trim() === ref;
  const missingRefs = [...fightEventRefs].filter((ref) => !events.some((e) => findInEvents(e, ref)));
  if (missingRefs.length > 0) {
    const toAdd = missingRefs
      .map((ref) => localEvents.find((le) => findInEvents(le, ref)))
      .filter(Boolean);
    events = [...events, ...toAdd];
  }

  // Если события из таблицы пришли без вариантов — подставляем choices только при точном совпадении title
  // (не по id: у random и destination_* могут совпадать id, но это разные ивенты)
  if (sheetData?.events?.length && events === sheetData.events) {
    events = events.map((e) => {
      if (e.choices?.length > 0) return e;
      const local = localEvents.find((l) => (l.title || '').trim() === (e.title || '').trim());
      return local ? { ...e, choices: local.choices } : e;
    });
  }

  const sheetIntro = (sheetData?.intro || []).map((s) => ({
    title: (s.title || '').trim(),
    text: (s.text || '').trim(),
    choices: (s.choices || [])
      .filter((c) => c.text && c.text.trim())
      .map((c) => {
        const text = (c.text || '').trim();
        const setVariable = c.setVariable ?? inferSetVariableFromText(text);
        return { text, setVariable, delta: c.delta ?? null };
      }),
  }));

  // Если из таблицы пришли слайды без вариантов — берём title/text из таблицы, choices из дефолта
  const hasValidChoices = sheetIntro.some((s) => s.choices?.length > 0);
  const introSlides =
    sheetIntro.length > 0 && hasValidChoices
      ? sheetIntro
      : sheetIntro.length > 0
        ? sheetIntro        .map((s, i) => ({
            ...s,
            choices: (DEFAULT_INTRO_SLIDES[i]?.choices || DEFAULT_INTRO_SLIDES[0]?.choices || [{ text: 'Продолжить', setVariable: null, delta: null }]).map((c) => ({ ...c, delta: c.delta ?? null })),
          }))
        : DEFAULT_INTRO_SLIDES;

  return {
    events,
    introSlides,
    shipStats: sheetData?.shipStats ?? DEFAULT_SHIP_STATS,
    crew: sheetData?.crew ?? [],
    fights: (sheetData?.fights?.length ? sheetData.fights : fightsJson) ?? [],
    loading,
    error,
    fromSheet: !!sheetData?.events?.length,
    refresh: load,
  };
}
