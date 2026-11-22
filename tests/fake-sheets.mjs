// 테스트용 가짜 구글 시트 / Apps Script 환경
// 실제 구글 시트처럼 동작하는 규칙을 일부 흉내 내요:
//  - 고정된 줄(열)과 고정 안 된 줄(열)을 한 칸으로 병합하면 오류
//  - 병합 칸의 일부만 고정하려고 하면 오류
//  - 이미 병합된 칸과 겹쳐서 병합하면 오류
// 실제 구글 서비스나 Firebase에는 전혀 접속하지 않아요. 이름은 모두 가짜예요.

const chain = (obj) => new Proxy(obj, {
  get(t, p) { return p in t ? t[p] : () => chain(t); },   // 모르는 꾸미기 함수(setBackground 등)는 그냥 통과
});

function makeSheet(name) {
  const sh = {
    name, frozenRows: 0, frozenCols: 0, merges: [], cells: {}, maxRows: 1000, maxCols: 26, cf: [],
    getName: () => sh.name,
    setName: (n) => { sh.name = n; return sh; },
    getMaxRows: () => sh.maxRows,
    getMaxColumns: () => sh.maxCols,
    insertColumnsAfter: (_a, n) => { sh.maxCols += n; },
    clear: () => { sh.cells = {}; return sh; },          // 실제처럼 병합은 남겨 둠
    clearConditionalFormatRules: () => { sh.cf = []; },
    setConditionalFormatRules: (r) => { sh.cf = r; },
    setColumnWidth() {}, setColumnWidths() {},
    setFrozenRows(n) {
      if (sh.merges.some(m => m.r <= n && m.r + m.nr - 1 > n)) throw new Error('병합 칸의 일부만 고정할 수 없어요');
      sh.frozenRows = n;
    },
    setFrozenColumns(n) {
      if (sh.merges.some(m => m.c <= n && m.c + m.nc - 1 > n)) throw new Error('병합 칸의 일부만 고정할 수 없어요(열)');
      sh.frozenCols = n;
    },
    getRange(r, c, nr = 1, nc = 1) { return makeRange(sh, r, c, nr, nc); },
    value(r, c) { return sh.cells[r + ',' + c]; },
  };
  return sh;
}

function makeRange(sh, r, c, nr, nc) {
  const inside = (m) => m.r >= r && m.c >= c && m.r + m.nr <= r + nr && m.c + m.nc <= c + nc;
  const overlaps = (m) => !(m.r + m.nr <= r || r + nr <= m.r || m.c + m.nc <= c || c + nc <= m.c);
  const rg = {
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { sh.cells[(r + i) + ',' + (c + j)] = x; })); return chain(rg); },
    setValue(x) { sh.cells[r + ',' + c] = x; return chain(rg); },
    breakApart() { sh.merges = sh.merges.filter(m => !overlaps(m)); return chain(rg); },
    merge() {
      const fr = sh.frozenRows, fc = sh.frozenCols;
      if (fr && r <= fr && r + nr - 1 > fr) throw new Error('고정된 줄과 고정 안 된 줄은 병합할 수 없어요');
      if (fc && c <= fc && c + nc - 1 > fc) throw new Error('고정된 열과 고정 안 된 열은 병합할 수 없어요');
      if (sh.merges.some(overlaps)) throw new Error('이미 병합된 칸과 겹쳐요');
      sh.merges.push({ r, c, nr, nc });
      return chain(rg);
    },
  };
  void inside;
  return chain(rg);
}

export function makeSpreadsheet(existingSheetNames = []) {
  const ss = {
    sheets: existingSheetNames.map(makeSheet),
    active: null,
    getSheetByName: (n) => ss.sheets.find(s => s.name === n) || null,
    insertSheet: (n) => { const s = makeSheet(n); ss.sheets.push(s); return s; },
    setActiveSheet: (s) => { ss.active = s; return s; },
    moveActiveSheet: (pos) => { ss.sheets = ss.sheets.filter(s => s !== ss.active); ss.sheets.splice(pos - 1, 0, ss.active); },
    toast() {},
  };
  return ss;
}

// Firestore REST 응답 형식으로 바꾸기
function toFs(v) {
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toFs(x)])) } };
  return { stringValue: String(v) };
}

// Apps Script 전역 객체들(SpreadsheetApp, UrlFetchApp 등)을 가짜로 만들어요
export function makeAppsScriptGlobals({ ss, groups, records, now = '2026-11-23' }) {
  const doc = (col) => (o) => ({ name: `projects/x/databases/(default)/documents/${col}/${o.id || (o.date + '_' + o.gid)}`, fields: Object.fromEntries(Object.entries(o).map(([k, x]) => [k, toFs(x)])) });
  return {
    SpreadsheetApp: {
      getActive: () => ss,
      newConditionalFormatRule: () => chain({ build: () => ({}) }),
    },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ FIREBASE_API_KEY: 'fake', FIREBASE_PROJECT_ID: 'fake', VIEWER_EMAIL: 'viewer@fake', VIEWER_PASSWORD: 'fake-pw' }) }) },
    UrlFetchApp: {
      fetch(url) {
        const body = url.includes('signInWithPassword') ? { idToken: 'fake-token' }
          : url.includes('/documents/groups') ? { documents: groups.map(doc('groups')) }
          : { documents: records.map(doc('attendance')) };
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
      },
    },
    Utilities: { formatDate: (_d, _tz, fmt) => (fmt === 'yyyy' ? now.slice(0, 4) : '11/23 02:00') },
    console: { error() {} },
  };
}
