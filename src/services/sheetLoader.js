/**
 * Загрузка данных из Google Sheets в реальном времени.
 * URL: File → Share → Publish to web → CSV
 */
const SHEET_BASE =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTfF7ITJA6Mspd94YBodVbHcn3KT3evIUz5XXQZiZ-xjl-9DG1GbLRAGW3fjqbyUmFk1BKMKkFdBdwA/pub?output=csv';
const SHEET_URL = SHEET_BASE;

/** gid листа ShipStats — укажите ID вкладки из URL при редактировании таблицы */
const SHIP_STATS_GID = '1262995639';
/** gid листа Crew/Команда */
const CREW_GID = '21323879';
/** gid листа Intro — если интро на отдельной вкладке, укажите здесь */
const INTRO_GID = '';
/** gid листа Fights — боевая система */
const FIGHTS_GID = '905768052';

const SHIP_STATS_URL = SHIP_STATS_GID ? `${SHEET_BASE}&gid=${SHIP_STATS_GID}` : null;
const CREW_URL = CREW_GID ? `${SHEET_BASE}&gid=${CREW_GID}` : null;
const INTRO_URL = INTRO_GID ? `${SHEET_BASE}&gid=${INTRO_GID}` : null;
const FIGHTS_URL = FIGHTS_GID ? `${SHEET_BASE}&gid=${FIGHTS_GID}` : null;

const FETCH_RETRIES = 3;
const FETCH_RETRY_DELAY_MS = 800;

async function fetchWithRetry(url, opts = {}) {
  let lastErr;
  for (let i = 0; i < FETCH_RETRIES; i++) {
    try {
      const res = await fetch(url, { mode: 'cors', ...opts });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < FETCH_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr;
}

const SHIP_STATS_HEADERS = ['hull', 'energy', 'supplies', 'morale'];

/**
 * Парсит CSV с учётом полей в кавычках (Google Sheets экспортирует так).
 */
function parseCSV(text) {
  let t = text.trim();
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1); // BOM
  const lines = t.split(/\r?\n/);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = parseCSVLine(lines[0], delimiter).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    const row = {};
    headers.forEach((h, j) => {
      let val = (values[j] ?? '').trim();
      while (val.startsWith('"') || val.startsWith('«') || val.startsWith('»')) {
        val = val.slice(1);
      }
      while (val.endsWith('"') || val.endsWith('«') || val.endsWith('»')) {
        val = val.slice(0, -1);
      }
      val = val.replace(/""/g, '"');
      row[h] = val.trim();
    });
    row._headers = headers;
    row._values = values;
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes) {
      current += c;
    } else if (c === delimiter) {
      result.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

function parseConsequences(str) {
  if (!str || str === '{}') return null;

  const tryParse = (raw) => {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const direct = tryParse(str);
  if (direct) return direct;

  // Поддержка "почти JSON" из таблицы (без кавычек у строк и ключей).
  const repaired = String(str)
    .replace(/([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_\-]*)""\s*:/g, '$1:')
    .replace(/"([^"]+)""\s*:/g, '"$1":')
    .replace(/([\{,]\s*)([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_\-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/:\s*([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_\-]*)(\s*(,|\}))/g, ': "$1"$2');

  return tryParse(repaired);
}

const RESOURCE_KEYS = ['hull', 'speed', 'energy', 'attack', 'supplies', 'morale', 'scrap', 'crew', 'stability'];

function parseNum(val) {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseInt(val, 10);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function splitConsequences(obj) {
  if (!obj || typeof obj !== 'object') return { delta: {}, setVariable: null, enemyDamage: undefined };
  const delta = {};
  const setVariable = {};
  let enemyDamage;
  Object.entries(obj).forEach(([k, v]) => {
    const kLower = String(k).toLowerCase().trim();
    const numVal = parseNum(v);
    if (RESOURCE_KEYS.includes(kLower) && numVal !== null) delta[kLower] = numVal;
    else if (PLAYER_VAR_KEYS.includes(kLower)) setVariable[kLower] = typeof v === 'string' ? v : String(v);
    else if (kLower === 'enemy_hp' && numVal !== null && numVal < 0) enemyDamage = Math.abs(numVal);
    else if (kLower === 'enemy_damage' && numVal !== null && numVal > 0) enemyDamage = numVal;
  });
  return { delta, setVariable: Object.keys(setVariable).length ? setVariable : null, enemyDamage };
}

function rowToEvent(row) {
  const textsByPosition = getOptTextsByPosition(row);
  const fallbackTexts = textsByPosition.length > 0 ? textsByPosition : getAllOptTextsFromRow(row);
  const choices = [];
  for (let i = 1; i <= 4; i++) {
    const text = getOptText(row, i) || textsByPosition[i - 1] || fallbackTexts[i - 1] || getRowValue(row, `вариант ${i}`) || getRowValue(row, `вариант${i}`);
    if (!text) break;
    const optReq = getOptReq(row, i);
    const consequences = getOptConsequences(row, i);
    let choice = {};
    if (consequences?.chance != null && consequences?.success != null && consequences?.failure != null) {
      const topLevel = splitConsequences(consequences);
      const succ = splitConsequences(consequences.success);
      const fail = splitConsequences(consequences.failure);
      const mergeSetVar = (sv) => (topLevel.setVariable && sv) ? { ...topLevel.setVariable, ...sv } : (topLevel.setVariable || sv);
      choice = {
        text,
        optReq,
        chance: consequences.chance,
        success: { hull: 0, energy: 0, scrap: 0, crew: 0, stability: 0, ...succ.delta },
        failure: { hull: 0, energy: 0, scrap: 0, crew: 0, stability: 0, ...fail.delta },
        successSetVariable: mergeSetVar(succ.setVariable),
        failureSetVariable: mergeSetVar(fail.setVariable),
        successEnemyDamage: succ.enemyDamage ?? topLevel.enemyDamage,
        failureEnemyDamage: fail.enemyDamage ?? topLevel.enemyDamage,
      };
    } else if (consequences) {
      const { delta, setVariable, enemyDamage } = splitConsequences(consequences);
      choice = {
        text,
        optReq,
        delta: { hull: 0, energy: 0, scrap: 0, crew: 0, stability: 0, ...delta },
        setVariable,
        enemyDamage,
      };
    } else {
      choice = { text, optReq, delta: {} };
    }
    choices.push(choice);
  }
  const id = getRowValue(row, 'id') || row.id || '';
  const eventVal = getRowValue(row, 'event') || row.event || '';
  return {
    id: id || eventVal + '-' + id,
    title: getRowValue(row, 'title') || row.title || '',
    description: getRowValue(row, 'text') || row.text || '',
    event: eventVal,
    event_req: getRowValue(row, 'event_req') || row.event_req || '',
    choices,
  };
}

const PLAYER_VAR_KEYS = ['ship', 'guest', 'dest', 'demon', 'engine', 'ship_mage', 'dest_lighthouse', 'dest_demon', 'fight', 'victory'];

function isPlayerVar(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).some((k) => PLAYER_VAR_KEYS.includes(k));
}

function getRowValue(row, key) {
  const keyNorm = key.toLowerCase().replace(/[- ]/g, '_');
  const found = Object.keys(row).find((x) => {
    const xn = x.toLowerCase().trim().replace(/[- ]/g, '_');
    return xn === keyNorm;
  });
  return found ? (row[found] ?? '').trim() : '';
}

/** Ищет колонку для opt N text — пробует разные варианты написания */
function getOptText(row, n) {
  const variants = [
    `opt${n}_text`,
    `opt${n} text`,
    `opt ${n} text`,
    `opt${n}-text`,
    `option${n}`,
    `option ${n}`,
    `choice${n}`,
    `choice ${n}`,
    `вариант ${n}`,
    `вариант${n}`,
    `опция ${n}`,
    `опция${n}`,
  ];
  for (const v of variants) {
    const val = getRowValue(row, v);
    if (val) return val;
  }
  // Прямой доступ по ключу (CSV может сохранять точные заголовки)
  const direct = row[`opt${n}_text`] || row[`opt${n} text`] || row[`choice${n}`] || row[`вариант ${n}`];
  if (direct && String(direct).trim()) return String(direct).trim();
  const headerMatch = Object.keys(row).find((h) => {
    const hn = h.toLowerCase();
    const numMatch = hn.match(/(\d+)/);
    const keyNum = numMatch ? parseInt(numMatch[1], 10) : null;
    if (keyNum !== n) return false;
    const hasOpt = hn.includes('opt') || hn.includes('option') || hn.includes('choice') || hn.includes('вариант') || hn.includes('опция');
    const hasText = hn.includes('text') || hn.includes('текст') || (!hn.includes('req') && !hn.includes('consequences'));
    return hasOpt && (hasText || hn.split(/[\s_-]/).some((p) => p === String(n)));
  });
  return headerMatch ? (row[headerMatch] ?? '').trim() : '';
}

/** Индексы колонок opt1_text, opt2_text... по порядку в заголовках */
function getOptTextIndices(headers) {
  if (!headers || !Array.isArray(headers)) return [];
  const indices = [];
  for (let n = 1; n <= 4; n++) {
    const idx = headers.findIndex((h) => {
      const hn = (h || '').toLowerCase();
      const numMatch = hn.match(/(\d+)/);
      const keyNum = numMatch ? parseInt(numMatch[1], 10) : null;
      if (keyNum !== n) return false;
      const isText = /text|текст/.test(hn) && !/req|consequences/.test(hn);
      const isOpt = /opt|option|choice|вариант|опция/.test(hn);
      return isOpt && isText;
    });
    if (idx >= 0) indices.push(idx);
  }
  return indices;
}

/** Собирает тексты опций по позиции колонок (надёжно при любой структуре) */
function getOptTextsByPosition(row) {
  const headers = row._headers;
  const values = row._values;
  if (!headers || !values) return [];
  const indices = getOptTextIndices(headers);
  return indices.map((idx) => (values[idx] ?? '').trim()).filter(Boolean);
}

/** Собирает тексты опций из строки по всем подходящим колонкам (fallback при нестандартных заголовках) */
function getAllOptTextsFromRow(row) {
  const byPosition = getOptTextsByPosition(row);
  if (byPosition.length > 0) return byPosition;

  const found = [];
  const skipKeys = ['id', 'event', 'event_req', 'title', 'text'];
  for (const [key, val] of Object.entries(row)) {
    if (key.startsWith('_')) continue;
    if (!val || !String(val).trim()) continue;
    const kn = key.toLowerCase().trim();
    if (skipKeys.some((s) => kn === s || kn.startsWith(s + '_'))) continue;
    const numMatch = kn.match(/(\d+)/);
    if (!numMatch) continue;
    const n = parseInt(numMatch[1], 10);
    if (n < 1 || n > 4) continue;
    const isReqOrCons = /req|consequences|последствия/.test(kn);
    const isOpt = /opt|option|choice|вариант|опция|text|текст/.test(kn) || /^\d+$/.test(kn);
    if (isOpt && !isReqOrCons) found.push({ n, text: String(val).trim() });
  }
  const byNum = {};
  found.forEach((f) => { if (!byNum[f.n]) byNum[f.n] = f.text; });
  return [1, 2, 3, 4].map((i) => byNum[i]).filter(Boolean);
}

/** Ищет колонку opt N req */
function getOptReq(row, n) {
  const variants = [
    `opt${n}_req`, `opt${n} req`, `opt ${n} req`, `opt ${n}_req`, `opt${n}-req`,
    `option${n}_req`, `option ${n} req`, `choice${n}_req`,
    `вариант ${n} req`, `опция ${n} req`,
  ];
  for (const v of variants) {
    const val = getRowValue(row, v);
    if (val) return val;
  }
  for (const [key, val] of Object.entries(row)) {
    if (key.startsWith('_')) continue;
    const kn = key.toLowerCase().replace(/[- ]/g, '_');
    if (kn.includes('req') && (kn.includes(`opt${n}`) || kn.includes(`option${n}`) || kn.match(new RegExp(`[^0-9]${n}[^0-9]`)))) {
      const s = String(val || '').trim();
      if (s) return s;
    }
  }
  return '';
}

/** Ищет колонку opt N consequences */
function getOptConsequences(row, n) {
  const variants = [
    `opt${n}_consequences`,
    `opt${n} consequences`,
    `opt ${n} consequences`,
    `opt${n}_delta`,
    `opt${n} delta`,
    `opt ${n} delta`,
  ];
  for (const v of variants) {
    const val = getRowValue(row, v);
    if (val) return parseConsequences(val);
  }
  return parseConsequences(
    row[`opt${n}_consequences`] ||
    row[`opt${n} consequences`] ||
    row[`opt${n}_delta`] ||
    row[`opt${n} delta`] ||
    ''
  );
}

function rowToIntroSlide(row) {
  const choices = [];
  const textsByPosition = getOptTextsByPosition(row);
  const fallbackTexts = textsByPosition.length > 0 ? textsByPosition : getAllOptTextsFromRow(row);
  for (let i = 1; i <= 4; i++) {
    const text = textsByPosition[i - 1] || getOptText(row, i) || getRowValue(row, `opt${i}_text`) || fallbackTexts[i - 1];
    if (!text) break;
    const consequences = getOptConsequences(row, i);
    const { delta, setVariable } = consequences ? splitConsequences(consequences) : { delta: {}, setVariable: null };
    choices.push({ text, setVariable, delta: Object.keys(delta).length ? delta : null });
  }
  return {
    id: getRowValue(row, 'id') || row.id,
    title: getRowValue(row, 'title') || row.title || '',
    text: getRowValue(row, 'text') || row.text || '',
    choices,
  };
}

/**
 * Проверяет, подходят ли playerVars и resources под event_req / opt_req.
 * Формат:
 * - "ship=merchant" — точное совпадение playerVars
 * - "supplies>=5" — ресурс supplies >= 5 (операторы: >=, <=, >, <)
 * - "ship=merchant|supplies>=10" — несколько условий через | или ,
 */
export function matchesEventReq(eventReq, playerVars, resources = {}) {
  if (!eventReq || !eventReq.trim()) return true;
  const parts = eventReq.split(/[|,]/).map((p) => p.trim());
  return parts.every((part) => {
    const match = part.match(/^(\w+)\s*(>=|<=|>|<|=)\s*(.+)$/);
    if (!match) return false;
    const [, key, op, valStr] = match;
    const rawVal = RESOURCE_KEYS.includes(key) ? (resources[key] ?? 0) : playerVars[key];
    const numVal = Number(rawVal);
    const numReq = Number(valStr);
    if (op === '=') return String(rawVal) === valStr || (Number.isFinite(numVal) && numVal === numReq);
    if (!Number.isFinite(numVal) || !Number.isFinite(numReq)) return false;
    if (op === '>=') return numVal >= numReq;
    if (op === '<=') return numVal <= numReq;
    if (op === '>') return numVal > numReq;
    if (op === '<') return numVal < numReq;
    return false;
  });
}

function parseIntroFromRows(rows) {
  const getEvent = (r) => (getRowValue(r, 'event') || r.event || '').toLowerCase();
  const introRows = rows.filter((r) => getEvent(r) === 'intro').sort((a, b) => (getRowValue(a, 'id') || a.id || 0) - (getRowValue(b, 'id') || b.id || 0));
  return introRows.slice(0, 4).map(rowToIntroSlide);
}

export async function fetchSheetData() {
  try {
    const mainText = await fetchWithRetry(SHEET_URL, { headers: { Accept: 'text/csv' } });
    const introText = INTRO_URL ? await fetchWithRetry(INTRO_URL, { headers: { Accept: 'text/csv' } }).catch(() => null) : null;
    const mainRows = parseCSV(mainText);
    if (mainRows.length === 0) return null;

    const getEvent = (r) => (getRowValue(r, 'event') || r.event || '').toLowerCase();
    const eventRow = (r) => {
      const ev = getEvent(r);
      return ev === 'random' || ev === 'market' || ev === 'destination_lighthouse' || ev === 'destination_demon' || ev === 'final' || /fight/i.test(ev);
    };
    const eventRows = mainRows.filter(eventRow);
    let intro = parseIntroFromRows(mainRows);
    if (intro.length === 0 && introText) {
      const introRows = parseCSV(introText);
      intro = parseIntroFromRows(introRows);
    }

    const events = eventRows.map((row) => {
      const ev = rowToEvent(row);
      const evType = (ev.event || '').toLowerCase();
      if (!(ev.event_req || '').trim()) {
        if (evType === 'destination_lighthouse') ev.event_req = 'dest=lighthouse';
        else if (evType === 'destination_demon') ev.event_req = 'dest=demon';
        else if (evType === 'final') ev.event_req = 'dest_lighthouse=done,dest_demon=done';
      }
      return ev;
    });
    return {
      intro,
      events,
    };
  } catch (e) {
    console.warn('[SheetLoader] Fetch failed:', e.message);
    return null;
  }
}

/** Дефолтные статы корабля, если таблица ShipStats недоступна */
export const DEFAULT_SHIP_STATS = {
  hull: 30,
  speed: 3,
  energy: 10,
  attack: 2,
  supplies: 20,
  morale: 2,
};

function findCol(headers, names) {
  const h = headers.map((x) => String(x || '').toLowerCase().trim());
  for (const n of names) {
    const idx = h.findIndex((x) => x === n.toLowerCase() || x.includes(n.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

export async function fetchShipStats(shipType = null) {
  if (!SHIP_STATS_URL) return DEFAULT_SHIP_STATS;
  try {
    const text = await fetchWithRetry(SHIP_STATS_URL, { headers: { Accept: 'text/csv' } });
    const rows = parseCSV(text);
    if (rows.length < 2) return DEFAULT_SHIP_STATS;

    const headers = rows[0]._headers || Object.keys(rows[0]).filter((k) => !k.startsWith('_'));
    const statsCol = findCol(headers, ['stats', 'stat', 'параметр', 'param', 'name', 'ключ', 'key']);
    const valueCol = findCol(headers, ['value', 'значение', 'val', 'значення']);

    if (statsCol < 0 || valueCol < 0) {
      console.warn('[SheetLoader] ShipStats: не найдены колонки stats и value');
      return DEFAULT_SHIP_STATS;
    }

    const stats = { ...DEFAULT_SHIP_STATS };
    const keyAliases = { health: 'hull', прочность: 'hull', энергия: 'energy', припасы: 'supplies', мораль: 'morale' };

    for (const row of rows) {
      const keyRaw = (row._values?.[statsCol] ?? row[headers[statsCol]] ?? '').toString().trim().toLowerCase();
      const valRaw = (row._values?.[valueCol] ?? row[headers[valueCol]] ?? '').toString().trim();
      if (!keyRaw) continue;

      const keyClean = keyRaw.replace(/\s*\(.*\)$/, '').trim();
      const key = keyAliases[keyClean] ?? (SHIP_STATS_HEADERS.includes(keyClean) ? keyClean : null);
      if (!key) continue;

      const num = parseInt(valRaw, 10);
      if (!Number.isNaN(num)) stats[key] = num;
    }

    return stats;
  } catch (e) {
    console.warn('[SheetLoader] ShipStats fetch failed:', e.message);
    return DEFAULT_SHIP_STATS;
  }
}

function findColCrew(headers, names) {
  const h = headers.map((x) => String(x || '').toLowerCase().trim());
  for (const n of names) {
    const idx = h.findIndex((x) => x === n.toLowerCase() || x.includes(n.toLowerCase()));
    if (idx >= 0) return idx;
  }
  return -1;
}

export function pickRandomName(str) {
  if (!str || !str.trim()) return '—';
  const parts = str.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[Math.floor(Math.random() * parts.length)] || '—';
}

/** Выбирает имена для команды один раз при старте игры */
export function pickCrewNames(rawCrew) {
  if (!rawCrew?.length) return [];
  return rawCrew.map((c) => ({
    ...c,
    name: pickRandomName(c.nameList ?? c.name ?? ''),
  }));
}

function normalizePassiveEffect(effect) {
  if (!effect || typeof effect !== 'object') return null;
  const normalized = {};
  Object.entries(effect).forEach(([k, v]) => {
    const key = String(k || '').trim().toLowerCase();
    const num = parseNum(v);
    if (key && num !== null) normalized[key] = num;
  });
  return Object.keys(normalized).length ? normalized : null;
}

function getStatusFromHp(hp) {
  const h = parseInt(hp, 10);
  if (Number.isNaN(h) || h <= 0) return 'убит';
  if (h < 20) return 'ранен';
  return 'работает';
}

export async function fetchCrew() {
  if (!CREW_URL) return [];
  try {
    const text = await fetchWithRetry(CREW_URL, { headers: { Accept: 'text/csv' } });
    const rows = parseCSV(text);
    if (rows.length < 2) return [];

    const headers = rows[0]._headers || Object.keys(rows[0]).filter((k) => !k.startsWith('_'));
    const idCol = findColCrew(headers, ['id']);
    const roleCol = findColCrew(headers, ['role', 'должность', 'role']);
    const nameCol = findColCrew(headers, ['name', 'имя', 'name']);
    const hpCol = findColCrew(headers, ['hp', 'здоровье', 'health']);
    const passiveCol = findColCrew(headers, ['passive', 'passive_effect', 'passive effect', 'effect', 'пассив', 'пассивный эффект']);

    const crew = [];
    for (const row of rows) {
      const id = idCol >= 0 ? (row._values?.[idCol] ?? row[headers[idCol]] ?? '').toString().trim() : '';
      const role = roleCol >= 0 ? (row._values?.[roleCol] ?? row[headers[roleCol]] ?? '').toString().trim() : '—';
      const nameRaw = nameCol >= 0 ? (row._values?.[nameCol] ?? row[headers[nameCol]] ?? '').toString().trim() : '—';
      const hp = hpCol >= 0 ? (row._values?.[hpCol] ?? row[headers[hpCol]] ?? '20').toString().trim() : '20';
      const passiveRaw = passiveCol >= 0 ? (row._values?.[passiveCol] ?? row[headers[passiveCol]] ?? '').toString().trim() : '';
      const passiveEffect = normalizePassiveEffect(parseConsequences(passiveRaw));

      crew.push({
        id: id || crew.length,
        role,
        nameList: nameRaw,
        hp: parseInt(hp, 10) || 20,
        status: getStatusFromHp(hp),
        passiveEffect,
      });
    }
    return crew;
  } catch (e) {
    console.warn('[SheetLoader] Crew fetch failed:', e.message);
    return [];
  }
}

/** Парсит таблицу Fights: ID, HP, Attack(d6), Icon, EventTurn1-5, EndFightEvent */
export async function fetchFights() {
  if (!FIGHTS_URL) return [];
  try {
    const text = await fetchWithRetry(FIGHTS_URL, { headers: { Accept: 'text/csv' } });
    const rows = parseCSV(text);
    if (rows.length < 2) return [];

    const fights = [];
    for (const row of rows) {
      const id = getRowValue(row, 'id') || getRowValue(row, 'fight') || row.id || row.ID || row.fight || row.Fight || '';
      if (!id) continue;
      const hp = parseInt(getRowValue(row, 'hp') || row.hp || row.HP || '0', 10) || 0;
      const attackD6 = parseInt(
        getRowValue(row, 'attack') || getRowValue(row, 'attack(d6)') || getRowValue(row, 'attack_d6') ||
        row.attack || row['Attack(d6)'] || row['Attack (d6)'] || '1',
        10
      ) || 1;
      const icon = getRowValue(row, 'icon') || row.icon || row.Icon || '';
      const getEventTurn = (n) => getRowValue(row, `eventturn_${n}`) || getRowValue(row, `eventturn${n}`) || row[`EventTurn_${n}`] || row[`EventTurn${n}`] || '';
      const eventTurn1 = getEventTurn(1);
      const eventTurn2 = getEventTurn(2);
      const eventTurn3 = getEventTurn(3);
      const eventTurn4 = getEventTurn(4);
      const eventTurn5 = getEventTurn(5);
      const endFightEvent = getRowValue(row, 'endfightevent') || row.endfightevent || row.EndFightEvent || '';
      const eventStart = getRowValue(row, 'eventstart') || getRowValue(row, 'event_start') || row.eventstart || row.EventStart || row['Event Start'] || '';

      fights.push({
        id: String(id).trim(),
        name: id,
        hp,
        attackD6,
        icon,
        eventStart: eventStart?.trim() || null,
        eventTurns: [eventTurn1, eventTurn2, eventTurn3, eventTurn4, eventTurn5],
        endFightEvent,
      });
    }
    return fights;
  } catch (e) {
    console.warn('[SheetLoader] Fights fetch failed:', e.message);
    return [];
  }
}
