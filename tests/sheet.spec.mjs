// 구글 시트용 표 계산(buildGrid) 테스트 — 시트·Firebase 없이 계산 결과만 확인해요. 이름은 가짜예요.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, '..', 'sheets', 'attendance-sheet.gs'), 'utf8'), ctx);
const buildGrid = (g, r) => JSON.parse(JSON.stringify(ctx.buildGrid(g, r)));

const groups = [
  { id: 'g02', name: '2목장', order: 2, members: [{ name: '라은혜' }] },
  { id: 'g01', name: '1목장', order: 1, members: [{ name: '가목자' }, { name: '나하늘' }, { name: '다소망' }] },
];
const records = [
  { date: '2026-11-15', gid: 'g01', present: ['가목자'], worship: ['나하늘'], absent: ['다소망'] },
  { date: '2026-11-22', gid: 'g01', present: ['가목자', '나하늘'], worship: [], absent: ['다소망'] },
  { date: '2026-12-06', gid: 'g02', present: [], worship: ['라은혜'], absent: [] },
];

test('시트: 이름은 왼쪽(A 목장, B 이름), 목장 순서대로', () => {
  const { values } = buildGrid(groups, records);
  expect(values[1].slice(0, 2)).toEqual(['목장', '이름']);
  expect(values.slice(4).map(r => r[0] + '/' + r[1])).toEqual(['1목장/가목자', '1목장/나하늘', '1목장/다소망', '2목장/라은혜']);
});

test('시트: 월별 표 사이에 빈 열이 한 칸 있다', () => {
  const { values, months } = buildGrid(groups, records);
  expect(months.map(m => m.title)).toEqual(['2026년 11월', '2026년 12월']);
  // 11월 주일 1,8,15,22,29 중 마지막 기록(12/6)까지 → 5개, 12월은 12/6까지 → 1개
  expect(months[0]).toMatchObject({ col: 2, span: 5 });
  expect(months[1]).toMatchObject({ col: 8, span: 1 });   // 2+5 = 7번 열이 빈 열
  expect(values[1][7]).toBe('');
  expect(values[1].slice(2, 7)).toEqual(['11/1', '11/8', '11/15', '11/22', '11/29']);
  expect(values[1][8]).toBe('12/6');
});

test('시트: O / △ / X / 빈칸이 맞게 들어간다', () => {
  const { values } = buildGrid(groups, records);
  const row = n => values.find(r => r[1] === n);
  expect(row('가목자').slice(2, 7)).toEqual(['', '', 'O', 'O', '']);
  expect(row('나하늘').slice(2, 7)).toEqual(['', '', '△', 'O', '']);
  expect(row('다소망').slice(2, 7)).toEqual(['', '', 'X', 'X', '']);
  expect(row('라은혜')[8]).toBe('△');
  expect(row('라은혜')[4]).toBe('');   // 그 주 2목장 제출 없음 → 빈칸
});

test('시트: 명단에서 빠진 사람, 삭제된 목장도 과거 기록은 남는다', () => {
  const gs = [{ id: 'g01', name: '1목장', order: 1, members: [{ name: '가목자' }] }];
  const rs = [
    { date: '2026-11-22', gid: 'g01', present: ['가목자'], absent: ['옛목원'] },
    { date: '2026-11-22', gid: 'gX', groupName: '없어진목장', present: ['바다온'] },
  ];
  const { values } = buildGrid(gs, rs);
  const names = values.slice(4).map(r => r[1]);
  expect(names).toEqual(['가목자', '옛목원', '바다온']);
  expect(values.find(r => r[1] === '옛목원')[values[1].indexOf('11/22')]).toBe('X');
  expect(values.find(r => r[1] === '바다온')[0]).toContain('삭제됨');
});

test('시트: 기록이 하나도 없으면 머리글만 있다', () => {
  const { values, months } = buildGrid(groups, []);
  expect(months).toEqual([]);
  expect(values[1]).toEqual(['목장', '이름']);
  expect(values.length).toBe(4 + 4);   // 머리글 4줄 + 4명
});

// 웹 앱 신호(doPost): 잠금으로 한 번에 하나씩, 실패해도 잠금은 풀린다
function webAppCtx(lockOk, updateThrows) {
  const c = { released: 0, runs: 0 };
  c.LockService = { getScriptLock: () => ({ tryLock: () => lockOk, releaseLock: () => { c.released++; } }) };
  c.ContentService = { createTextOutput: t => t };
  c.console = { error() {} };
  vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(here, '..', 'sheets', 'attendance-sheet.gs'), 'utf8'), c);
  c.updateAttendanceSheet = () => { c.runs++; if (updateThrows) throw new Error('x'); };
  return c;
}
test('시트 신호: 정상이면 업데이트하고 ok', () => {
  const c = webAppCtx(true, false);
  expect(c.doPost({})).toBe('ok'); expect(c.runs).toBe(1); expect(c.released).toBe(1);
});
test('시트 신호: 다른 업데이트가 진행 중이면 기다리다 busy', () => {
  const c = webAppCtx(false, false);
  expect(c.doPost({})).toBe('busy'); expect(c.runs).toBe(0);
});
test('시트 신호: 오류가 나도 잠금을 풀고 error', () => {
  const c = webAppCtx(true, true);
  expect(c.doPost({})).toBe('error'); expect(c.released).toBe(1);
});

test('시트: 같은 목장이 이어지는 행은 병합 범위로 묶인다', () => {
  const { groupRuns, values } = buildGrid(groups, records);
  // 머리글 4줄 다음부터: 1목장 3명(0부터 4~6), 2목장 1명(7)
  expect(groupRuns).toEqual([{ start: 4, span: 3 }, { start: 7, span: 1 }]);
  groupRuns.forEach(g => { for (let i = 0; i < g.span; i++) expect(values[g.start + i][0]).toBe(values[g.start][0]); });
});

test('시트: 맨 위 3번째 줄에 날짜별 총 참석(O+△)이 나온다', () => {
  const { values } = buildGrid(groups, records);
  expect(values[2].slice(0, 2)).toEqual(['전체', '총 참석']);
  const col = d => values[1].indexOf(d);
  expect(values[2][col('11/15')]).toBe(2);   // 가목자 O + 나하늘 △
  expect(values[2][col('11/22')]).toBe(2);   // 가목자 O + 나하늘 O
  expect(values[2][col('12/6')]).toBe(1);    // 라은혜 △
  expect(values[2][col('11/8')]).toBe('');   // 그날 제출 없음
});

test('시트: 방문자 수 기록을 켠 목장만 방문자 수 줄이 생긴다', () => {
  const gs = [
    { id: 'g01', name: '1목장', order: 1, members: [{ name: '가목자' }] },
    { id: 'g02', name: '새가족목장', order: 2, members: [{ name: '나하늘' }], countGuests: true },
  ];
  const rs = [
    { date: '2026-11-22', gid: 'g01', present: ['가목자'], absent: [], guests: ['가짜손님'] },
    { date: '2026-11-22', gid: 'g02', present: ['나하늘'], absent: [], guests: [], guestCount: 4 },
    { date: '2026-11-15', gid: 'g02', present: [], absent: ['나하늘'], guests: ['가짜1', '가짜2'] },
  ];
  const { values, guestRows, groupRuns } = buildGrid(gs, rs);
  const guestLines = values.slice(4).filter(r => r[1] === '방문자 수');   // 머리글 4줄 제외, 목장 줄만
  expect(guestLines.length).toBe(1);                       // 1목장에는 없음
  expect(guestLines[0][0]).toBe('새가족목장');
  const col = d => values[1].indexOf(d);
  expect(guestLines[0][col('11/22')]).toBe(4);              // 숫자로 적은 값
  expect(guestLines[0][col('11/15')]).toBe(2);              // 숫자가 없으면 이름 개수
  expect(guestRows).toEqual([values.indexOf(guestLines[0])]);
  expect(groupRuns[1].span).toBe(2);                        // 목장명 병합에 방문자 줄 포함
  expect(values[2][col('11/22')]).toBe(2);                  // 총 참석에는 방문자 미포함
});

test('연도별 시트: 기록이 있는 연도 + 올해, 최신 연도부터', () => {
  const rs = [{ date: '2025-12-28' }, { date: '2026-01-04' }, { date: '2026-11-22' }];
  expect(JSON.parse(JSON.stringify(ctx.yearsToWrite(rs, 2026)))).toEqual([2026, 2025]);
  expect(JSON.parse(JSON.stringify(ctx.yearsToWrite([], 2027)))).toEqual([2027]);          // 기록 없어도 올해 시트
  expect(JSON.parse(JSON.stringify(ctx.yearsToWrite(rs, 2027)))).toEqual([2027, 2026, 2025]);
  expect(ctx.sheetNameForYear(2026)).toBe('2026 출석현황');
});

test('연도별 시트: 그 해 기록만 표에 들어가고 제목에 연도가 붙는다', () => {
  const rs = [
    { date: '2025-12-28', gid: 'g01', present: ['가목자'], absent: [] },
    { date: '2026-01-04', gid: 'g01', present: [], absent: ['가목자'] },
  ];
  const y26 = rs.filter(r => r.date.startsWith('2026'));
  const { values, months } = buildGrid(groups, y26.length ? y26 : [], );
  expect(months.map(m => m.title)).toEqual(['2026년 1월']);
  const titled = JSON.parse(JSON.stringify(ctx.buildGrid(groups, y26, '2026년 청년부 출석')));
  expect(titled.values[0][0]).toBe('2026년 청년부 출석');
  expect(values[1]).not.toContain('12/28');
});

test('시트: 총 참석 아래 4번째 줄에 날짜별 방문자 수 합계가 나온다', () => {
  const gs = [{ id: 'g01', name: '1목장', order: 1, members: [{ name: '가목자' }] },
              { id: 'g02', name: '2목장', order: 2, members: [{ name: '나하늘' }], countGuests: true }];
  const rs = [
    { date: '2026-11-22', gid: 'g01', present: ['가목자'], absent: [], guests: ['가짜1', '가짜2'] },
    { date: '2026-11-22', gid: 'g02', present: ['나하늘'], absent: [], guests: [], guestCount: 3 },
    { date: '2026-11-15', gid: 'g01', present: [], absent: ['가목자'], guests: [] },
  ];
  const { values } = buildGrid(gs, rs);
  expect(values[3].slice(0, 2)).toEqual(['전체', '방문자 수']);
  const col = d => values[1].indexOf(d);
  expect(values[3][col('11/22')]).toBe(5);    // 이름 2명 + 숫자 3명
  expect(values[3][col('11/15')]).toBe(0);    // 제출은 했지만 방문자 없음
  expect(values[3][col('11/8')]).toBe('');    // 제출 없음
  expect(values[2][col('11/22')]).toBe(2);    // 총 참석은 그대로 O+△
});
