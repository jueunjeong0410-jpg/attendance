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
  expect(values.slice(2).map(r => r[0] + '/' + r[1])).toEqual(['1목장/가목자', '1목장/나하늘', '1목장/다소망', '2목장/라은혜']);
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
  const names = values.slice(2).map(r => r[1]);
  expect(names).toEqual(['가목자', '옛목원', '바다온']);
  expect(values.find(r => r[1] === '옛목원')[values[1].indexOf('11/22')]).toBe('X');
  expect(values.find(r => r[1] === '바다온')[0]).toContain('삭제됨');
});

test('시트: 기록이 하나도 없으면 머리글만 있다', () => {
  const { values, months } = buildGrid(groups, []);
  expect(months).toEqual([]);
  expect(values[1]).toEqual(['목장', '이름']);
  expect(values.length).toBe(2 + 4);
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
