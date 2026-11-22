// 시트에 실제로 쓰는 부분(writeSheet_, updateAttendanceSheet) 테스트
// 가짜 구글 시트(fake-sheets.mjs)로 병합·고정·연도별 시트가 끝까지 잘 되는지 확인해요. 이름은 가짜예요.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSpreadsheet, makeAppsScriptGlobals } from './fake-sheets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '..', 'sheets', 'attendance-sheet.gs'), 'utf8');

const groups = [
  { id: 'g01', name: '가목장', order: 1, members: [{ name: '가목자' }, { name: '나하늘' }, { name: '다소망' }] },
  { id: 'g02', name: '라목장', order: 2, members: [{ name: '라은혜' }, { name: '마다온' }] },
];
const records = [
  { date: '2025-12-28', gid: 'g01', present: ['가목자'], worship: [], absent: ['나하늘', '다소망'], guests: [] },
  { date: '2026-11-15', gid: 'g01', present: ['가목자'], worship: ['나하늘'], absent: ['다소망'], guests: ['가짜손님'] },
  { date: '2026-11-22', gid: 'g02', present: ['라은혜'], worship: [], absent: ['마다온'], guests: [] },
];

function run(ss, recs = records) {
  const ctx = makeAppsScriptGlobals({ ss, groups, records: recs });
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx.updateAttendanceSheet();
  return ctx;
}
const hasMerge = (sh, r, c, nr, nc) => sh.merges.some(m => m.r === r && m.c === c && m.nr === nr && m.nc === nc);

test('시트 쓰기: 같은 목장명은 A열에서 병합되고, 머리글 4줄이 고정된다', () => {
  const ss = makeSpreadsheet();
  run(ss);
  const sh = ss.getSheetByName('2026 출석현황');
  expect(sh.frozenRows).toBe(4);
  expect(sh.frozenCols).toBe(2);
  expect(hasMerge(sh, 5, 1, 3, 1)).toBe(true);    // 가목장 3명 (5~7번째 줄)
  expect(hasMerge(sh, 8, 1, 2, 1)).toBe(true);    // 라목장 2명 (8~9번째 줄)
  expect(hasMerge(sh, 3, 1, 2, 1)).toBe(true);    // '전체' (3~4번째 줄)
  expect(sh.value(3, 2)).toBe('총 참석');
  expect(sh.value(4, 2)).toBe('방문자 수');
});

test('시트 쓰기: 예전 고정 상태(3줄)가 남아 있어도 오류 없이 다시 그려진다 (회귀)', () => {
  const ss = makeSpreadsheet(['2026 출석현황']);
  ss.getSheetByName('2026 출석현황').frozenRows = 3;     // 지난 버전이 남긴 상태
  expect(() => run(ss)).not.toThrow();
  const sh = ss.getSheetByName('2026 출석현황');
  expect(hasMerge(sh, 5, 1, 3, 1)).toBe(true);
  expect(sh.frozenRows).toBe(4);
});

test('시트 쓰기: 두 번 연달아 업데이트해도 병합이 깨지지 않는다', () => {
  const ss = makeSpreadsheet();
  run(ss);
  expect(() => run(ss)).not.toThrow();
  const sh = ss.getSheetByName('2026 출석현황');
  expect(sh.merges.filter(m => m.c === 1 && m.r >= 5).length).toBe(2);
});

test('연도별 시트: 예전 "출석현황" 시트는 올해 시트로 이름이 바뀌고, 최신 연도가 맨 앞', () => {
  const ss = makeSpreadsheet(['출석현황']);
  run(ss);
  expect(ss.sheets.map(s => s.name)).toEqual(['2026 출석현황', '2025 출석현황']);
  expect(ss.getSheetByName('출석현황')).toBeNull();
  const y25 = ss.getSheetByName('2025 출석현황');
  expect(y25.value(1, 1)).toBe('2025년 청년부 출석');
  expect(y25.value(2, 3)).toBe('12/7');            // 2025년 12월 주일부터
});

test('시트 쓰기: 목장별 방문자 수 줄은 없다 (4번째 줄 합계만)', () => {
  const ss = makeSpreadsheet();
  run(ss);
  const sh = ss.getSheetByName('2026 출석현황');
  const names = [];
  for (let r = 5; r <= 9; r++) names.push(sh.value(r, 2));
  expect(names).toEqual(['가목자', '나하늘', '다소망', '라은혜', '마다온']);
  const col = [...Array(12).keys()].map(i => i + 1).find(c => sh.value(2, c) === '11/15');
  expect(sh.value(4, col)).toBe(1);               // 11/15 방문자 1명 (이름으로 적은 손님)
});
