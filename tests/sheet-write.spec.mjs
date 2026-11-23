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
  expect(ss.sheets.map(s => s.name)).toEqual(['분기별통계', '새가족', '2026 출석현황', '2025 출석현황']);
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
  expect(ss.sheets.map(x => x.name)).toEqual(['분기별통계', '새가족', '2026 출석현황', '전체인원']);
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

/* ---------- 새가족 탭 · 알림 메일 ---------- */
const NEW = [
  { id: 'm_20030405_신소망', name: '신소망', isNew: true, status: 'active', firstVisit: '2026-11-15', registeredAt: '2026-11-22' },
  { id: 'm_20010101_오래된', name: '오래된', status: 'active' },                                    // 가져온 기존 교인(새가족 아님)
];
const NEW_CONTACTS = [{ id: 'm_20030405_신소망', phone: '010-5555-6666', address: '가짜구 가짜로 2', birth: '2003-04-05', memo: '가짜 메모' }];
const runNC = (ss, opt = {}) => run(ss, opt.records || [], { groups: [], collections: { members: opt.members || NEW, contacts: NEW_CONTACTS, welcome: opt.welcome || [] }, password: false, ...opt });

test('새가족 탭: 두 번째 탭, 앱에서 등록한 새가족만 인적사항·출석 횟수와 함께 (전화번호는 글자 그대로)', () => {
  const ss = makeSpreadsheet();
  runNC(ss, { welcome: [{ date: '2026-11-15', checked: { m_20030405_신소망: { name: '신소망' } } }, { date: '2026-11-22', checked: { m_20030405_신소망: { name: '신소망' } } }],
    records: [{ date: '2026-11-22', gid: 'g01', present: ['신소망'], worship: [], absent: [], ids: { 신소망: 'm_20030405_신소망' } }] });
  expect(ss.sheets[1].name).toBe('새가족');
  const sh = ss.sheets[1];
  const row = (r) => Array.from({ length: 9 }, (_, c) => sh.value(r, c + 1));
  expect(row(2)).toEqual(['등록한 날', '처음 온 날', '이름', '생년월일', '전화번호', '주소', '메모', '상태', '출석 횟수']);
  expect(row(3)).toEqual(['2026-11-22', '2026-11-15', '신소망', '2003-04-05', '010-5555-6666', '가짜구 가짜로 2', '가짜 메모', '출석 중', 2]);  // 같은 날 두 번 체크돼도 1번
  expect(sh.value(4, 3)).toBeUndefined();                                                     // 기존 교인은 안 나옴
});

test('새가족 탭: 보기 계정(예전 방식)으로 접속하면 연락처를 못 읽으니 새가족 탭은 건드리지 않는다', () => {
  const ss = makeSpreadsheet();
  run(ss, [], { groups: [], collections: { members: NEW, contacts: NEW_CONTACTS }, oauth: false });
  expect(ss.getSheetByName('새가족')).toBeNull();
});

test('새가족 알림(회계팀): 처음 켤 때 있던 새가족은 기록만, 그다음 등록부터 메일·푸시로 한 번씩 (전화·주소는 안 보냄)', () => {
  const props = { NEWCOMER_EMAILS: 'acct@fake.test, acct2@fake.test', NEWCOMER_PUSH: 'fake-secret-topic' };
  let ctx = runNC(makeSpreadsheet(), { props });
  expect(ctx.mails.length + ctx.pushes.length).toBe(0);
  expect(props.NOTIFIED_IDS).toContain('m_20030405_신소망');
  const more = NEW.concat([{ id: 'm_20050505_새사람', name: '새사람', birthYear: 2005, isNew: true, firstVisit: '2026-11-22', registeredAt: '2026-11-23' }]);
  ctx = runNC(makeSpreadsheet(), { props, members: more });
  expect(ctx.mails.length).toBe(1);
  expect(ctx.mails[0].to).toBe('acct@fake.test,acct2@fake.test');
  expect(ctx.mails[0].subject).toBe('[청년부] 새가족 새사람님 헌금봉투를 준비해 주세요');
  expect(ctx.mails[0].body).toContain('처음 온 날: 2026-11-22');
  expect(ctx.pushes).toEqual([expect.objectContaining({ topic: 'fake-secret-topic', title: '[청년부] 새가족 새사람님 헌금봉투를 준비해 주세요' })]);
  expect(ctx.mails[0].body + ctx.pushes[0].message).not.toMatch(/010-|가짜구/);
  ctx = runNC(makeSpreadsheet(), { props, members: more });
  expect(ctx.mails.length + ctx.pushes.length).toBe(0);                                        // 다시 보내지 않음
});

test('새가족 알림: 받을 곳이 없으면 기록만, 보내기가 모두 실패하면 다음에 다시 보낸다', () => {
  const props = { NOTIFIED_IDS: '' };
  const one = [{ id: 'm_1', name: '가', isNew: true }], two = one.concat([{ id: 'm_2', name: '나', isNew: true }]);
  let ctx = runNC(makeSpreadsheet(), { props, members: one });
  expect(ctx.mails.length).toBe(0);
  expect(props.NOTIFIED_IDS).toContain('m_1');
  props.NEWCOMER_EMAILS = 'acct@fake.test';
  ctx = runNC(makeSpreadsheet(), { props, members: two, mailFail: true });
  expect(props.NOTIFIED_IDS).not.toContain('m_2');
  ctx = runNC(makeSpreadsheet(), { props, members: two });
  expect(ctx.mails.map(m => m.subject)).toEqual(['[청년부] 새가족 나님 헌금봉투를 준비해 주세요']);
});

/* ---------- 주일 출석 미제출 알림 ---------- */
const G2 = [{ id: 'g01', name: '가목장', leader: '가목자', order: 1 }, { id: 'g02', name: '나목장', leader: '나목자', order: 2 },
  { id: '2025_g09', year: 2025, name: '옛목장', order: 9 }];
function ctxFor(opt) { const c = makeAppsScriptGlobals({ ss: makeSpreadsheet(), groups: G2, password: false, ...opt }); vm.createContext(c); vm.runInContext(code, c); return c; }

test('미제출 알림: 일요일에 아직 안 낸 올해 목장만 목자들에게 (메일·푸시)', () => {
  const props = { REMIND_EMAILS: 'mokja@fake.test', REMIND_PUSH: 'fake-mokja-topic' };
  const c = ctxFor({ now: '2026-11-22', props, records: [{ date: '2026-11-22', gid: 'g01' }, { date: '2026-11-15', gid: 'g02' }] });
  expect(c.remindUnsubmitted()).toBe('sent 1');
  expect(c.mails[0].subject).toBe('[청년부] 오늘 출석체크를 부탁드려요 (1개 목장)');
  expect(c.mails[0].body).toContain('나목장(나목자)');
  expect(c.mails[0].body).not.toContain('가목장');
  expect(c.pushes[0].topic).toBe('fake-mokja-topic');
});

test('미제출 알림: 모두 냈거나 일요일이 아니면 보내지 않는다', () => {
  const props = { REMIND_EMAILS: 'mokja@fake.test' };
  let c = ctxFor({ now: '2026-11-22', props, records: [{ date: '2026-11-22', gid: 'g01' }, { date: '2026-11-22', gid: 'g02' }] });
  expect(c.remindUnsubmitted()).toBe('all-done');
  c = ctxFor({ now: '2026-11-23', props, records: [] });
  expect(c.remindUnsubmitted()).toBe('not-sunday');
  expect(c.mails.length).toBe(0);
});

test('미제출 알림 켜기: 매주 일요일 15시 30분 무렵(한국 시간) 예약, 여러 번 눌러도 하나', () => {
  const c = ctxFor({});
  c.turnOnSundayReminder(); c.turnOnSundayReminder();
  expect(c.triggers.length).toBe(1);
  expect(c.triggers[0].fn).toBe('remindUnsubmitted');
  expect(c.triggers[0].spec).toEqual([['timeBased'], ['onWeekDay', 'SUNDAY'], ['atHour', 15], ['nearMinute', 30], ['inTimezone', 'Asia/Seoul']]);
});

/* ---------- 출결버스 출석 가져오기 ---------- */
const CB_HEAD = ['번호', '이름', '출', '결'].concat(Array.from({ length: 31 }, (_, i) => String(i + 1))).concat(['총시간']);
const cbRow = (no, name, days) => [no, name, '', ''].concat(Array.from({ length: 31 }, (_, i) => (days.includes(i + 1) ? '등(13:56)하(미등록)' : '-'))).concat(['']);
const CB = [['2026-11'], CB_HEAD,
  cbRow('1', '가하늘', [1, 5, 8]),        // 5일은 목요일 → 안 가져옴
  cbRow('2', '다은혜', [15]),
  cbRow('3', '다은혜', [22]),              // 동명이인: 번호로 구분
  cbRow('4', '모르는사람', [22]),
  cbRow('5', '안온사람', []),
];
const ROSTER = [HEAD, row(1, '가하늘', '1996-02-15', '', '1012345678'), row(2, '다은혜', '2001-06-28', '', '1011112222'), row(3, '다은혜', '2005-03-27', '', '1033334444')];
const CB_MEMBERS = [{ id: 'm_19960215_가하늘', name: '가하늘' }, { id: 'm_20010628_다은혜', name: '다은혜' }, { id: 'm_20050327_다은혜', name: '다은혜' }];

test('출결버스 표 → 주일별 출석: 주일만, 동명이인은 번호로, 못 찾은 사람은 따로', () => {
  const c = ctxFor({});
  const r = JSON.parse(JSON.stringify(c.checkbusToWelcome(CB, '2026-11', c.rosterIdsByNo(ROSTER), {})));
  expect(r.byDate).toEqual({ '2026-11-01': { m_19960215_가하늘: '가하늘' }, '2026-11-08': { m_19960215_가하늘: '가하늘' },
    '2026-11-15': { m_20010628_다은혜: '다은혜' }, '2026-11-22': { m_20050327_다은혜: '다은혜' }, '2026-11-29': {} });
  expect(r.unmatched).toEqual(['모르는사람']);
  expect(() => c.checkbusToWelcome(CB, '', {}, {})).toThrow(/연월/);
});

test('출결버스 가져오기: 새가족팀 출석에 더하고(기존 체크 유지), 다시 해도 중복 없음, 시트도 업데이트', () => {
  const ss = makeSpreadsheet(['전체인원', '출결버스 가져오기'], { '전체인원': ROSTER, '출결버스 가져오기': CB });
  const c = makeAppsScriptGlobals({ ss, password: false, collections: { members: CB_MEMBERS,
    welcome: [{ id: '2026-11-22', date: '2026-11-22', checked: { m_새가족: { name: '새가족', at: 'x' } } }] } });
  vm.createContext(c); vm.runInContext(code, c);
  const msg = c.importCheckbus();
  expect(msg).toContain('출석 4건');
  expect(msg).toContain('모르는사람');
  const w = c.commits[0].writes;
  expect(w.map(x => x.update.name.split('/').pop()).sort()).toEqual(['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22']);
  const d22 = w.find(x => x.update.name.endsWith('2026-11-22')).update.fields.checked.mapValue.fields;
  expect(Object.keys(d22).sort()).toEqual(['m_20050327_다은혜', 'm_새가족']);              // 기존 체크 유지
  expect(d22.m_20050327_다은혜.mapValue.fields.name).toEqual({ stringValue: '다은혜' });     // (테스트 명단엔 출생연도가 없어 그대로)
  expect(ss.getSheetByName('분기별통계')).not.toBeNull();                                    // 가져온 뒤 시트 업데이트
});

test('출결버스 가져오기: 스크립트 주인의 구글 로그인이 아니면 하지 않는다', () => {
  const ss = makeSpreadsheet(['전체인원', '출결버스 가져오기'], { '전체인원': ROSTER, '출결버스 가져오기': CB });
  const c = makeAppsScriptGlobals({ ss, oauth: false });
  vm.createContext(c); vm.runInContext(code, c);
  expect(() => c.importCheckbus()).toThrow(/구글 로그인으로만/);
});

test('동명이인 표시: 시트 새가족 탭·알림에 생년 두 자리 (예: 김가은05)', () => {
  const ms = [{ id: 'm_a', name: '김가은', birthYear: 2001, isNew: true, registeredAt: '2026-11-20' },
    { id: 'm_b', name: '김가은', birthYear: 2005, isNew: true, registeredAt: '2026-11-21' }];
  const props = { NOTIFIED_IDS: 'm_a', NEWCOMER_PUSH: 'fake-topic' };
  const ss = makeSpreadsheet();
  const c = runNC(ss, { members: ms, props });
  const sh = ss.getSheetByName('새가족');
  expect([sh.value(3, 3), sh.value(4, 3)]).toEqual(['김가은05', '김가은01']);
  expect(c.pushes.map(p => p.title)).toEqual(['[청년부] 새가족 김가은05님 헌금봉투를 준비해 주세요']);
});

test('분기별통계 그래프: 최신 분기의 주별 출석 추이(선)와 목장별 출석률(막대, 60% 미만은 빨간 계열), 업데이트해도 그래프는 2개만', () => {
  const ss = makeSpreadsheet();
  const gs = [{ id: 'g01', name: '가목장', order: 1, members: [{ name: '가' }, { name: '나' }] }, { id: 'g02', name: '나목장', order: 2, members: [{ name: '다' }, { name: '라' }, { name: '마' }] }];
  const rs = [
    { date: '2026-11-15', gid: 'g01', present: ['가', '나'], worship: [], absent: [], guests: [] },
    { date: '2026-11-15', gid: 'g02', present: ['다'], worship: [], absent: ['라', '마'], guests: [] },
    { date: '2026-11-22', gid: 'g01', present: ['가'], worship: ['나'], absent: [], guests: [] },
  ];
  run(ss, rs, { groups: gs });
  run(ss, rs, { groups: gs });                                                   // 두 번 업데이트해도
  const sh = ss.getSheetByName('분기별통계');
  expect(sh.charts.length).toBe(2);
  const [line, bar] = sh.charts;
  expect(line.type).toBe('LINE');
  expect(line.opts.title).toBe('2026년 4분기 주별 출석 추이');
  expect(line.pos).toEqual([3, 15]);
  expect(bar.type).toBe('BAR');
  expect(bar.opts.isStacked).toBe(true);
  const col = (c, r0, n) => Array.from({ length: n }, (_, i) => sh.value(r0 + i, c));
  expect(col(24, 2, 2)).toEqual(['11/15', '11/22']);                              // 주일
  expect(col(25, 2, 2)).toEqual([3, 2]);                                         // 공식 출석
  expect(col(26, 2, 2)).toEqual([3, 1]);                                         // 목장모임(O)
  expect(col(28, 2, 2)).toEqual(['가목장', '나목장']);                            // 출석률 높은 순
  expect([sh.value(2, 29), sh.value(2, 30)]).toEqual([100, '']);                  // 100% → 파란 막대
  expect([sh.value(3, 29), sh.value(3, 30)]).toEqual(['', 33]);                   // 33% → 빨간 막대
});

test('푸시: ntfy가 429(너무 많음)면 한 번 더 보내고, NTFY_TOKEN이 있으면 그 계정으로 보낸다', () => {
  const props = { NEWCOMER_PUSH: 'fake-topic', REMIND_PUSH: 'fake-topic2', NTFY_TOKEN: 'tk_fake' };
  const c = ctxFor({ props });
  c.ntfy429 = 1;
  expect(c.testAlerts()).toBe('회계팀 1곳, 목자 1곳으로 보냈어요.');
  expect(c.ntfyCalls).toBe(3);                                                  // 첫 번째는 429 → 다시 1번 + 두 번째 1번
  expect(c.pushes.every(p => p.auth === 'Bearer tk_fake')).toBe(true);
  c.ntfy429 = 2;
  expect(c.testAlerts()).toContain('실패가 있어요');                            // 두 번 다 429면 실패로 알림
});
