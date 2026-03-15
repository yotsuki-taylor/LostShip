/**
 * Загрузка данных из Google Sheets в реальном времени.
 * URL: File → Share → Publish to web → CSV
 */
const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vTfF7ITJA6Mspd94YBodVbHcn3KT3evIUz5XXQZiZ-xjl-9DG1GbLRAGW3fjqbyUmFk1BKMKkFdBdwA/pub?output=csv';

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
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

const RESOURCE_KEYS = ['hull', 'energy', 'scrap', 'crew', 'stability'];

function splitConsequences(obj) {
  if (!obj || typeof obj !== 'object') return { delta: {}, setVariable: null };
  const delta = {};
  const setVariable = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (RESOURCE_KEYS.includes(k) && typeof v === 'number') delta[k] = v;
    else if (PLAYER_VAR_KEYS.includes(k)) setVariable[k] = v;
  });
  return { delta, setVariable: Object.keys(setVariable).length ? setVariable : null };
}

function rowToEvent(row) {
  const choices = [];
  for (let i = 1; i <= 4; i++) {
    const text = getOptText(row, i);
    if (!text) break;
    const optReq = getOptReq(row, i);
    const consequences = getOptConsequences(row, i);
    let choice = {};
    if (consequences?.chance != null && consequences?.success != null && consequences?.failure != null) {
      const succ = splitConsequences(consequences.success);
      const fail = splitConsequences(consequences.failure);
      choice = {
        text,
        optReq,
        chance: consequences.chance,
        success: { hull: 0, energy: 0, scrap: 0, crew: 0, stability: 0, ...succ.delta },
        failure: { hull: 0, energy: 0, scrap: 0, crew: 0, stability: 0, ...fail.delta },
        successSetVariable: succ.setVariable,
        failureSetVariable: fail.setVariable,
      };
    } else if (consequences) {
      const { delta, setVariable } = splitConsequences(consequences);
      choice = {
        text,
        optReq,
        delta: { hull: 0, energy: 0, scrap: 0, crew: 0, stability: 0, ...delta },
        setVariable,
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

const PLAYER_VAR_KEYS = ['ship', 'guest', 'dest', 'demon', 'engine', 'ship_mage'];

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
  const variants = [`opt${n}_req`, `opt${n} req`, `opt ${n} req`];
  for (const v of variants) {
    const val = getRowValue(row, v);
    if (val !== undefined) return val;
  }
  return (row[`opt${n}_req`] || row[`opt${n} req`] || '').trim();
}

/** Ищет колонку opt N consequences */
function getOptConsequences(row, n) {
  const variants = [`opt${n}_consequences`, `opt${n} consequences`, `opt ${n} consequences`];
  for (const v of variants) {
    const val = getRowValue(row, v);
    if (val) return parseConsequences(val);
  }
  return parseConsequences(row[`opt${n}_consequences`] || row[`opt${n} consequences`] || '');
}

function rowToIntroSlide(row) {
  const choices = [];
  const textsByPosition = getOptTextsByPosition(row);
  const fallbackTexts = textsByPosition.length > 0 ? textsByPosition : getAllOptTextsFromRow(row);
  for (let i = 1; i <= 4; i++) {
    const text = textsByPosition[i - 1] || getOptText(row, i) || getRowValue(row, `opt${i}_text`) || fallbackTexts[i - 1];
    if (!text) break;
    const consequences = getOptConsequences(row, i);
    const setVariable = consequences && isPlayerVar(consequences) ? consequences : null;
    choices.push({ text, setVariable });
  }
  return {
    id: getRowValue(row, 'id') || row.id,
    title: getRowValue(row, 'title') || row.title || '',
    text: getRowValue(row, 'text') || row.text || '',
    choices,
  };
}

/**
 * Проверяет, подходят ли playerVars под event_req.
 * Формат: "ship=merchant" или "ship=merchant|guest=scientist" (все условия должны совпасть)
 */
export function matchesEventReq(eventReq, playerVars) {
  if (!eventReq || !eventReq.trim()) return true;
  const parts = eventReq.split(/[|,]/).map((p) => p.trim());
  return parts.every((part) => {
    const [key, val] = part.split('=').map((s) => s.trim());
    return playerVars[key] === val;
  });
}

export async function fetchSheetData() {
  try {
    const res = await fetch(SHEET_URL, {
      mode: 'cors',
      headers: { Accept: 'text/csv' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const rows = parseCSV(text);
    if (rows.length === 0) return null;

    const getEvent = (r) => (getRowValue(r, 'event') || r.event || '').toLowerCase();
    const introRows = rows.filter((r) => getEvent(r) === 'intro').sort((a, b) => (getRowValue(a, 'id') || a.id || 0) - (getRowValue(b, 'id') || b.id || 0));
    const randomRows = rows.filter((r) => getEvent(r) === 'random');

    return {
      intro: introRows.slice(0, 4).map(rowToIntroSlide),
      events: randomRows.map(rowToEvent),
    };
  } catch (e) {
    console.warn('[SheetLoader] Fetch failed:', e.message);
    return null;
  }
}
