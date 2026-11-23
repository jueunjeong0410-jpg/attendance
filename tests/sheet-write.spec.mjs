// 시트에 실제로 쓰는 부분(writeSheet_, updateAttendanceSheet) 테스트
// 가짜 구글 시트(fake-sheets.mjs)로 병합·고정·연도별 시트가 끝까지 잘 되는지 확인해요. 이름은 가짜예요.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSpreadsheet, makeAppsScriptGlobals } from './fake-sheets.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
// Apps Script 프로젝트에는 시트 스크립트 + report(앱의 report.js와 같은 내용) 두 파일이 함께 있어요
const code = fs.readFileSync(path.join(here, '..', 'report.js'), 'utf8') + '\n' + fs.readFileSync(path.join(here, '..', 'sheets', 'attendance-sheet.gs'), 'utf8');

const groups = [
  { id: 'g01', name: '가목장', order: 1, members: [{ name: '가목자' }, { name: '나하늘' }, { name: '다소망' }] },
  { id: 'g02', name: '라목장', order: 2, members: [{ name: '라은혜' }, { name: '마다온' }] },
];
const records = [
  { date: '2025-12-28', gid: 'g01', present: ['가목자'], worship: [], absent: ['나하늘', '다소망'], guests: [] },
  { date: '2026-11-15', gid: 'g01', present: ['가목자'], worship: ['나하늘'], absent: ['다소망'], guests: ['가짜손님'] },
  { date: '2026-11-22', gid: 'g02', present: ['라은혜'], worship: [], absent: ['마다온'], guests: [] },
];

function run(ss, recs = records, opt = {}) {
  const ctx = makeAppsScriptGlobals({ ss, groups: opt.groups || groups, records: recs, ...opt });
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

test('연도별 시트: 예전 "출석현황" 시트는 올해 시트로 이름이 바뀌고, 분기별통계 다음에 최신 연도부터', () => {
  const ss = makeSpreadsheet(['출석현황']);
  run(ss);
  expect(ss.sheets.map(s => s.name)).toEqual(['분기별통계', '2026 출석현황', '2025 출석현황']);
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

test('연도별 시트: 그 해 목장만 쓰고, 지난해 시트는 기록에 남은 목장 이름·명단 그대로', () => {
  const ss = makeSpreadsheet();
  const gs = [
    { id: 'g01', name: '가목장', order: 1, members: [{ name: '가목자' }, { name: '나하늘' }] },            // 2026 (연도 표시 없음)
    { id: '2027_g01', year: 2027, name: '가목장', order: 1, members: [{ name: '새목원' }] },               // 2027 새 목장 (같은 이름)
  ];
  const rs = [
    { date: '2026-11-22', gid: 'g01', groupName: '가목장', present: ['가목자'], worship: [], absent: ['나하늘'], guests: [] },
    { date: '2027-01-03', gid: '2027_g01', groupName: '가목장', present: ['새목원'], worship: [], absent: [], guests: [] },
  ];
  run(ss, rs, { groups: gs, now: '2027-01-05' });
  const names = (sh) => { const out = []; for (let r = 5; r < 20; r++) { const v = sh.value(r, 2); if (v) out.push(v); } return out; };
  expect(names(ss.getSheetByName('2026 출석현황'))).toEqual(['가목자', '나하늘']);   // 2027 명단이 섞이지 않음
  expect(names(ss.getSheetByName('2027 출석현황'))).toEqual(['새목원']);
});

test('Firebase 접속: 비밀번호 없이 스크립트 주인의 구글 로그인으로 읽는다', () => {
  const ss = makeSpreadsheet();
  const ctx = run(ss, records, { password: false });
  expect(ctx.calls.some(c => c.url.includes('signInWithPassword'))).toBe(false);
  expect(ctx.calls.every(c => c.auth === 'Bearer fake-oauth')).toBe(true);
  expect(ss.getSheetByName('2026 출석현황')).not.toBeNull();
});

test('Firebase 접속: 구글 로그인이 안 되면 예전 방식(보기 계정)으로 읽고, 둘 다 안 되면 분명한 오류', () => {
  const ss = makeSpreadsheet();
  const ctx = run(ss, records, { oauth: false });
  expect(ctx.calls.some(c => c.url.includes('signInWithPassword'))).toBe(true);
  expect(ss.getSheetByName('2026 출석현황')).not.toBeNull();
  expect(() => run(makeSpreadsheet(), records, { oauth: false, password: false })).toThrow(/Firebase에 접속하지 못했어요/);
});

/* ---------- 교인 명단 가져오기 (전체인원 탭 → 앱) ---------- */
const HEAD = ['번호', '반', '이름', '출결번호', '생년월일', '학교', '학년', '어머니전화', '아버지전화', '학생전화', '입금명', '수강료', '납부일', '주소', '메모', '등록일'];
const row = (n, name, birth, hint, phone, addr = '', memo = '', reg = '2025-01-05 14:31:05') => [n, '청년부', name, '', birth, hint, '', '', '', phone, '', '0', '1', addr, memo, reg];
const roster = [HEAD,
  row(1, '가하늘', '1996-02-15', '가목장', '1012345678'),
  row(2, '나소망', '2006-10-25', '목자', '1098765432', '가짜동 1번지', '가짜 메모'),
  row(3, '다은혜', '2001-06-28', '새가족팀', '1011112222'),
  row(4, '다은혜', '2005-03-27', '라목장', '1033334444'),      // 동명이인: 생일이 달라서 따로
  row(5, '', '', '', ''),                                          // 빈 줄은 건너뜀
];

test('명단 가져오기: 전화번호 앞 0 복원·하이픈, 동명이인은 생일로 구분, 빈 줄 건너뜀', () => {
  const ctx = makeAppsScriptGlobals({ ss: makeSpreadsheet() });
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const docs = JSON.parse(JSON.stringify(ctx.rosterToDocs(roster)));
  expect(docs.map(d => d.id)).toEqual(['m_19960215_가하늘', 'm_20061025_나소망', 'm_20010628_다은혜', 'm_20050327_다은혜']);
  expect(docs[0].contact.phone).toBe('010-1234-5678');
  expect(docs[0].member).toEqual({ name: '가하늘', status: 'active', hint: '가목장', registeredAt: '2025-01-05', birthYear: 1996 });
  expect(docs[1].contact).toEqual({ phone: '010-9876-5432', address: '가짜동 1번지', birth: '2006-10-25', memo: '가짜 메모' });
  // 모두가 보는 교인 명단(member)에는 전화번호·주소·생일이 없다
  docs.forEach(d => expect(Object.keys(d.member).sort()).toEqual(['birthYear', 'hint', 'name', 'registeredAt', 'status']));
});

test('명단 가져오기: 이미 앱에 있는 사람은 건드리지 않고(여러 번 눌러도 중복 없음), 연락처는 따로 저장', () => {
  const ss = makeSpreadsheet(['전체인원'], { '전체인원': roster });
  const ctx = makeAppsScriptGlobals({ ss, collections: { members: [{ id: 'm_19960215_가하늘', name: '가하늘' }] } });
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const msg = ctx.importRoster();
  expect(msg).toContain('새로 3명');
  const writes = ctx.commits.flatMap(c => c.writes);
  const paths = writes.map(w => w.update.name.split('/documents/')[1]);
  expect(paths.filter(p => p.startsWith('members/')).length).toBe(3);
  expect(paths.filter(p => p.startsWith('contacts/')).length).toBe(3);
  expect(paths).not.toContain('members/m_19960215_가하늘');
  // 교인 문서는 '없을 때만 만들기' 조건이 붙어서, 앱에서 고친 내용을 덮어쓰지 않는다
  writes.filter(w => w.update.name.includes('/members/')).forEach(w => expect(w.currentDocument).toEqual({ exists: false }));
  expect(writes.find(w => w.update.name.endsWith('contacts/m_20061025_나소망')).update.fields.phone).toEqual({ stringValue: '010-9876-5432' });
});

test('명단 가져오기: 스크립트 주인의 구글 로그인이 아니면(보기 계정) 하지 않는다', () => {
  const ss = makeSpreadsheet(['전체인원'], { '전체인원': roster });
  const ctx = makeAppsScriptGlobals({ ss, oauth: false });
  vm.createContext(ctx); vm.runInContext(code, ctx);
  expect(() => ctx.importRoster()).toThrow(/구글 로그인으로만/);
  expect(ctx.commits.length).toBe(0);
});

/* ---------- 분기별 통계 탭 ---------- */
test('분기별통계 탭: 언제나 맨 앞 탭이고, 분기마다 한 줄(최신 분기부터), 연도별 목장 출석률 표', () => {
  const ss = makeSpreadsheet(['전체인원', '분기별통계']);
  const gs = [{ id: 'g01', name: '가목장', order: 1, members: [{ name: '가목자' }, { name: '나하늘' }] }];
  const rs = [
    { date: '2026-09-27', gid: 'g01', groupName: '가목장', present: ['가목자'], worship: [], absent: ['나하늘'], guests: [] },
    { date: '2026-11-15', gid: 'g01', groupName: '가목장', present: ['가목자'], worship: ['나하늘'], absent: [], guests: ['가짜손님'] },
  ];
  run(ss, rs, { groups: gs });
  expect(ss.sheets[0].name).toBe('분기별통계');
  expect(ss.sheets[1].name).toBe('2026 출석현황');
  const sh = ss.sheets[0];
  const row = (r) => Array.from({ length: 13 }, (_, c) => sh.value(r, c + 1));
  expect(row(3)[0]).toBe('분기');
  expect(row(4).slice(0, 4)).toEqual(['2026년 4분기', '10/01 ~ 12/31', 1, 2]);   // 공식 출석 2명
  expect(row(4)[7]).toBe(1);                                                    // 방문자 합계
  expect(row(5).slice(0, 4)).toEqual(['2026년 3분기', '07/01 ~ 09/30', 1, 1]);
  expect(sh.value(7, 1)).toBe('2026년 목장별 출석률(%)');
  expect([sh.value(8, 1), sh.value(8, 4), sh.value(8, 5)]).toEqual(['가목장', 50, 100]);  // 3분기 50%, 4분기 100%
  expect(sh.frozenRows).toBe(3);
});
