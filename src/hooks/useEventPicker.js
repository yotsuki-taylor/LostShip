import { useCallback } from 'react';
import { matchesEventReq } from '../services/sheetLoader';

export function useEventPicker({ events, playerVars, resources }) {
  const getEventKey = useCallback((e) => `${(e?.event || '').toLowerCase()}-${e?.id ?? e?.title ?? ''}`, []);

  const isDestinationEvent = useCallback((e) => {
    const ev = (e?.event || '').toLowerCase();
    return ev === 'destination_lighthouse' || ev === 'destination_demon';
  }, []);

  const pickStoryEvent = useCallback(
    (nextDestId, shownSet, currentTurn) => {
      const dest = playerVars.dest;
      const destKey = dest === 'lighthouse' ? 'lighthouse' : dest === 'demon' ? 'demon' : null;
      const destEvents = events
        .filter((e) => {
          const ev = (e?.event || '').toLowerCase();
          if (ev === 'destination_lighthouse') return dest === 'lighthouse';
          if (ev === 'destination_demon') return dest === 'demon';
          if (ev === 'final') return true;
          return false;
        })
        .sort((a, b) => (Number(a.id) || 0) - (Number(b.id) || 0));
      const notShown = (e) => !shownSet.has(getEventKey(e));
      const availableDest = destEvents.filter(notShown);
      const destById = (id) => destEvents.find((e) => Number(e.id) === Number(id));
      const destByIdAvailable = (id) => availableDest.find((e) => Number(e.id) === Number(id));
      if (!destKey) return null;
      if (nextDestId === 1 && destById(1)) return (destByIdAvailable(1) ?? destById(1));
      if (nextDestId === 6) {
        const finalReady = playerVars.dest_lighthouse === 'done' && playerVars.dest_demon === 'done';
        if (finalReady) {
          const finalEvent = events.find((e) => (e?.event || '').toLowerCase() === 'final' && matchesEventReq(e.event_req, playerVars, resources));
          if (finalEvent && notShown(finalEvent)) return finalEvent;
        }
        if (destById(6)) return (destByIdAvailable(6) ?? destById(6));
      }
      const useDest = destById(nextDestId);
      const useDestAvailable = destByIdAvailable(nextDestId) ?? useDest;
      return useDestAvailable ?? null;
    },
    [events, playerVars, resources, getEventKey]
  );

  const pickRandomEvent = useCallback(
    (shownSet) => {
      const randomEvents = events.filter(
        (e) => (e?.event || '').toLowerCase() === 'random' && matchesEventReq(e.event_req, playerVars, resources)
      );
      const notShown = (e) => !shownSet.has(getEventKey(e));
      const available = randomEvents.filter(notShown);
      const pool = available.length > 0 ? available : randomEvents;
      return pool[Math.floor(Math.random() * pool.length)] ?? null;
    },
    [events, playerVars, resources, getEventKey]
  );

  const pickMarketEvent = useCallback(
    () => {
      const marketEvents = events.filter(
        (e) => (e?.event || '').toLowerCase() === 'market' && matchesEventReq(e.event_req, playerVars, resources)
      );
      return marketEvents[Math.floor(Math.random() * marketEvents.length)] ?? null;
    },
    [events, playerVars, resources]
  );

  const findEventByIdOrTitle = useCallback(
    (ref) => {
      if (!ref || !events?.length) return null;
      const s = String(ref).trim();
      return events.find((e) => String(e.id) === s || (e.event || '').trim() === s || (e.title || '').trim() === s) || null;
    },
    [events]
  );

  return { getEventKey, isDestinationEvent, pickStoryEvent, pickRandomEvent, pickMarketEvent, findEventByIdOrTitle };
}
