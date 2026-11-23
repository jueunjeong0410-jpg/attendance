// 분기 보고 계산(report.js) 테스트 — 앱과 시트 스크립트가 함께 쓰는 계산이에요. 이름은 가짜예요.
import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
const R = createRequire(import.meta.url)('../report.js');

const groups = [
  { id: 'g01', name: '가목장', order: 1, members: [{ name: '가목자', mid: 'm1' }, { name: '나하늘', mid: 'm2' }, { name: '다소망' }] },
  { id: '2027_g01', year: 2027, name: '새목장', order: 1, members: [{ name: '새사람', mid: 'm9' }] },   // 다른 해 목장은 빠짐
];
const sun = ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25', '2026-11-01'];
const rec = (d, present, worship, absent, guests = []) => ({ date: d, gid: 'g01', present, worship, absent, guests, ids: { 가목자: 'm1', 나하늘: 'm2' } });
const records = [
  rec(sun[0], ['가목자', '나하늘'], [], ['다소망']),
  rec(sun[1], ['가목자'], ['다소망'], ['나하늘'], ['손님1', '손님2']),
  rec(sun[2], ['가목자'], [], ['나하늘', '다소망']),
  rec(sun[3], ['가목자'], [], ['나하늘', '다소망']),
  rec(sun[4], ['가목자'], [], ['나하늘', '다소망']),
  rec('2026-09-27', ['가목자'], [], ['나하늘', '다소망']),                       // 3분기
];
const ck = (...ids) => Object.fromEntries(ids.map(i => [i, { name: i }]));
const welcomes = [
  { date: sun[1], checked: ck('m2', 'n1') },          // 나하늘: 목자는 결석, 새가족팀은 출석 → 공식 출석
  { date: sun[2], checked: ck('n1') },
  { date: sun[3], checked: ck('n1') },
];
const members = [{ id: 'n1', name: '새가족1', isNew: true, firstVisit: sun[1] }, { id: 'n2', name: '새가족2', isNew: true, firstVisit: '2026-08-02' }];

test('분기 범위·이전 분기·라벨', () => {
  expect(R.quarterOf('2026-11-23')).toBe('2026-Q4');
  expect(R.quarterRange('2024-Q1')).toEqual({ from: '2024-01-01', to: '2024-03-31' });
  expect(R.prevQuarter('2027-Q1')).toBe('2026-Q4');
  expect(R.quarterLabel('2026-Q4')).toBe('2026년 4분기');
});

test('분기 통계: 공식 출석(합집합)·목장모임·방문자·새가족·목장 출석률', () => {
  const s = R.quarterStats('2026-Q4', groups, records, welcomes, members);
  expect(s.sundays).toBe(5);
  // 주별 공식 출석: 2, (가목자·다소망△·나하늘[새가족팀]·새가족1)=4, 2, 2, 1
  expect(s.weekly.map(w => w.official)).toEqual([2, 4, 2, 2, 1]);
  expect(s.weekly.map(w => w.group)).toEqual([2, 1, 1, 1, 1]);
  expect(s.avgOfficial).toBe(2.2);
  expect(s.avgGroup).toBe(1.2);
  expect([s.maxOfficial, s.minOfficial]).toEqual([4, 1]);
  expect(s.guests).toBe(2);
  expect(s.newcomers).toBe(1);                                    // 새가족2는 3분기
  expect(s.settled).toBe(1);                                      // 새가족1은 3번 출석
  expect(s.roster).toBe(3);                                       // 2026 목장만
  expect(s.groupRates).toEqual([{ gid: 'g01', name: '가목장', rate: 47, weeks: 5 }]);   // O+△ (2+2+1+1+1)=7 ÷ 명단 15 = 46.7%
});

test('4주 연속 결석: 마지막 4번의 주일에 한 번도 체크 안 된 사람 (새가족팀 체크도 출석으로 침)', () => {
  const s = R.quarterStats('2026-Q4', groups, records, welcomes, members);
  // 나하늘: 10/11 새가족팀 출석 → 마지막 4주(10/11~11/1) 중 1번 출석 → 아님. 다소망: 10/11 △ → 아님
  expect(s.absent4).toEqual([]);
  const s2 = R.quarterStats('2026-Q4', groups, records.concat([rec('2026-11-08', ['가목자'], [], ['나하늘', '다소망'])]), welcomes, members);
  expect(s2.absent4.map(a => a.name)).toEqual(['나하늘', '다소망']);   // 10/18~11/8 연속 결석
});

test('기록이 있는 분기 목록, 기록 없는 분기는 0', () => {
  expect(R.quartersWithData(records, welcomes)).toEqual(['2026-Q3', '2026-Q4']);
  const e = R.quarterStats('2026-Q1', groups, records, welcomes, members);
  expect([e.sundays, e.avgOfficial, e.absent4.length]).toEqual([0, 0, 0]);
});

test('이름 맞추기: 교인 명단에 한 명뿐인 이름은 목장 명단과 연결 안 돼 있어도 같은 사람으로 본다 (동명이인·떠난 사람 제외)', () => {
  const ms = [{ id: 'a', name: '가' }, { id: 'b1', name: '나' }, { id: 'b2', name: '나' }, { id: 'c', name: '다', status: 'left' }];
  expect(R.uniqueNames(ms)).toEqual({ 가: 'a' });
  const gs = [{ id: 'g1', name: '1목장', members: [{ name: '가' }, { name: '나' }] }];
  const r = R.reconcile(gs, { g1: { present: ['가', '나'], worship: [], absent: [] } }, { a: { name: '가' } }, ms);
  expect(r.both.map(x => x.name)).toEqual(['가']);                           // '가'는 연결 없이도 일치
  expect(r.unlinked.map(x => x.name)).toEqual(['나']);                       // 동명이인은 목자가 골라야
  expect(R.reconcile(gs, { g1: { present: ['가'], worship: [], absent: [] } }, { a: { name: '가' } }).both.length).toBe(0);  // 명단 안 주면 예전처럼
});
