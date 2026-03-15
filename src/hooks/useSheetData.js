import { useState, useEffect, useCallback } from 'react';
import { fetchSheetData, fetchShipStats, fetchCrew, DEFAULT_SHIP_STATS } from '../services/sheetLoader';
import eventsJson from '../data/events.json';
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
      { text: 'Торговец', setVariable: { ship: 'merchant' } },
      { text: 'Эсминец', setVariable: { ship: 'destroyer' } },
    ],
  },
  {
    title: 'Попутчик',
    text: 'Кто сопровождает вас в этом рейсе?',
    choices: [
      { text: 'Учёный', setVariable: { guest: 'scientist' } },
      { text: 'Воин', setVariable: { guest: 'warrior' } },
    ],
  },
  {
    title: 'Цель',
    text: 'Куда держите курс?',
    choices: [
      { text: 'Маяк', setVariable: { dest: 'lighthouse' } },
      { text: 'Рынок', setVariable: { dest: 'market' } },
    ],
  },
  {
    title: 'В путь',
    text: 'Буря ждёт. Удачи, капитан.',
    choices: [{ text: 'Выходить', setVariable: null }],
  },
];

export function useSheetData() {
  const [sheetData, setSheetData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [data, shipStats, crew] = await Promise.all([
        fetchSheetData(),
        fetchShipStats(),
        fetchCrew(),
      ]);
      setSheetData(
        data ? { ...data, shipStats: shipStats ?? DEFAULT_SHIP_STATS, crew: crew ?? [] } : { shipStats: DEFAULT_SHIP_STATS, crew: crew ?? [] }
      );
      setError(null);
    } catch (e) {
      setError(e.message);
      setSheetData({ shipStats: DEFAULT_SHIP_STATS, crew: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  const localEvents = normalizeEvents(eventsJson);
  let events = sheetData?.events?.length ? sheetData.events : localEvents;

  // Если события из таблицы пришли без вариантов — подставляем choices из локальных
  if (sheetData?.events?.length && events === sheetData.events) {
    events = events.map((e) => {
      if (e.choices?.length > 0) return e;
      const local = localEvents.find((l) => String(l.id) === String(e.id) || l.title === e.title);
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
        return { text, setVariable };
      }),
  }));

  // Если из таблицы пришли слайды без вариантов — берём title/text из таблицы, choices из дефолта
  const hasValidChoices = sheetIntro.some((s) => s.choices?.length > 0);
  const introSlides =
    sheetIntro.length > 0 && hasValidChoices
      ? sheetIntro
      : sheetIntro.length > 0
        ? sheetIntro.map((s, i) => ({
            ...s,
            choices: (DEFAULT_INTRO_SLIDES[i]?.choices || DEFAULT_INTRO_SLIDES[0]?.choices || [{ text: 'Продолжить', setVariable: null }]),
          }))
        : DEFAULT_INTRO_SLIDES;

  return {
    events,
    introSlides,
    shipStats: sheetData?.shipStats ?? DEFAULT_SHIP_STATS,
    crew: sheetData?.crew ?? [],
    loading,
    error,
    fromSheet: !!sheetData,
    refresh: load,
  };
}
