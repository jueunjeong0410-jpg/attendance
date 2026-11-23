// 청년부 출석 앱 핵심 기능 테스트
// - 모든 테스트는 '체험 모드'(브라우저 안에만 저장)로 돌고, 이름은 전부 가짜입니다.
// - 1234 / 0000은 체험 모드 전용 비밀번호이며 실제 서비스 비밀번호가 아닙니다.
import { test, expect } from '@playwright/test';

const EDIT_PW = '1234';
const VIEW_PW = '0000';
const NF_PW = '5678';   // 체험 모드 전용 새가족팀 비밀번호

async function login(page, pw) {
  await page.fill('#pw', pw);
  await page.click('#pwGo');
}
async function setupGroups(page) {
  await page.goto('/');
  await login(page, EDIT_PW);
  await page.goto('/#check');
  await page.click('#make13');
  await expect(page.locator('.gp')).toHaveCount(13);
}
async function fillRoster(page, names) {
  await page.click('#edit');
  await page.fill('#en', '테스트 목장');
  await page.fill('#el', '가목자');
  await page.fill('#em', names.join('\n'));
  await page.click('#eSave');
  await expect(page.locator('.m')).toHaveCount(names.length);
}

test('로그인 전에는 출석 정보가 보이지 않는다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#pw')).toBeVisible();
  await expect(page.locator('#v-dashboard')).toBeHidden();
  await expect(page.locator('#v-check')).toBeHidden();
  await expect(page.locator('.tabs')).toBeHidden();
});

test('틀린 비밀번호는 거절된다', async ({ page }) => {
  await page.goto('/');
  await login(page, '9999');
  await expect(page.locator('#pwMsg')).toContainText('맞지 않아요');
  await expect(page.locator('#v-dashboard')).toBeHidden();
});

test('목장 13개를 한 번에 만든다', async ({ page }) => {
  await setupGroups(page);
  await expect(page.locator('.gp').first()).toContainText('1목장');
  await expect(page.locator('.gp').last()).toContainText('13목장');
});

test('명단 수정 후 출석을 제출하면 대시보드에 반영된다', async ({ page }) => {
  await setupGroups(page);
  await fillRoster(page, ['가목자', '나하늘', '다소망', '라은혜*', '마다온']);
  await expect(page.locator('.m em')).toHaveCount(1); // 새가족 표시 1명
  for (const n of ['가목자', '나하늘', '라은혜']) await page.click(`.m[data-n="${n}"]`);
  await page.fill('#guests', '가짜방문자');
  await page.click('#submit');
  await expect(page.locator('.gp[aria-pressed=true]')).toContainText('제출됨');

  await page.goto('/#dashboard');
  await expect(page.locator('#tTotal')).toContainText('3');
  await expect(page.locator('#tTotal')).toContainText('/ 5명');
  await expect(page.locator('#kSub')).toHaveText('1 / 13');
  await expect(page.locator('#kNew')).toHaveText('1명');
  await expect(page.locator('#kGuest')).toHaveText('1명');

  await page.click('[data-open]');
  const detail = page.locator('.detail').first();
  await expect(detail).toContainText('출석 3명');
  await expect(detail).toContainText('결석 2명');
  await expect(detail).toContainText('다소망');
  await expect(detail).toContainText('가짜방문자');
});

test('다시 제출하면 이전 기록을 덮어쓴다', async ({ page }) => {
  await setupGroups(page);
  await fillRoster(page, ['가목자', '나하늘', '다소망']);
  await page.click('#all');
  await page.click('#submit');
  await expect(page.locator('#submit')).toHaveText('다시 제출');
  await page.click('#none');
  await page.click('.m[data-n="가목자"]');
  await page.click('#submit');
  await page.goto('/#dashboard');
  await expect(page.locator('#tTotal')).toContainText('1');
  await expect(page.locator('#tTotal')).toContainText('/ 3명');
});

test('다른 주일로 넘기면 그 주 기록만 보인다', async ({ page }) => {
  await setupGroups(page);
  await fillRoster(page, ['가목자', '나하늘']);
  await page.click('#all');
  await page.click('#submit');
  await page.goto('/#dashboard');
  await expect(page.locator('#kSub')).toHaveText('1 / 13');
  await page.click('#prev');
  await expect(page.locator('#kSub')).toHaveText('0 / 13');
  await page.click('#next');
  await expect(page.locator('#kSub')).toHaveText('1 / 13');
});

test('보기 비밀번호로는 대시보드만 보고 편집은 못 한다', async ({ page }) => {
  await setupGroups(page);
  await page.click('#logout');
  await login(page, VIEW_PW);
  await page.goto('/#dashboard');
  await expect(page.locator('#kSub')).toHaveText('0 / 13');
  await page.goto('/#check');
  await expect(page.locator('#checkBody')).toContainText('보기 전용');
  await expect(page.locator('#submit')).toHaveCount(0);
  await expect(page.locator('#edit')).toHaveCount(0);
});

test('로그아웃하면 비밀번호 화면으로 돌아가고 다시 로그인할 수 있다', async ({ page }) => {
  await page.goto('/');
  await login(page, VIEW_PW);
  await expect(page.locator('#v-dashboard')).toBeVisible();
  await page.click('#logoutD');
  await expect(page.locator('#pw')).toBeVisible();
  await expect(page.locator('#v-dashboard')).toBeHidden();
  await login(page, VIEW_PW);
  await expect(page.locator('#v-dashboard')).toBeVisible();
});

test('이름에 코드를 넣어도 실행되지 않는다 (보안)', async ({ page }) => {
  await setupGroups(page);
  const evil = '<img src=x onerror="window.__hacked=1">';
  await fillRoster(page, [evil]);
  await page.goto('/#dashboard');
  await page.click('[data-open]');
  await expect(page.locator('.detail')).toContainText(evil);
  expect(await page.evaluate(() => window.__hacked)).toBeUndefined();
});

test('꾹 누르면 △(예배만), 다시 짧게 누르면 결석이 된다', async ({ page }) => {
  await setupGroups(page);
  await fillRoster(page, ['가목자', '나하늘', '다소망']);
  await page.click('.m[data-n="가목자"]');                 // 짧게 → O
  const target = page.locator('.m[data-n="나하늘"]');
  await target.hover();
  await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();   // 꾹 → △
  await expect(target).toHaveAttribute('aria-pressed', 'mixed');
  await expect(target.locator('.dot')).toHaveText('△');
  await expect(page.locator('.m[data-n="가목자"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cnt')).toContainText('2 / 3명 출석');
  await expect(page.locator('#cnt')).toContainText('O 1 · △ 1');

  await page.click('#submit');
  await page.goto('/#dashboard');
  await expect(page.locator('#tTotal')).toContainText('2');        // 예배 출석 = O + △
  await expect(page.locator('#kGroup')).toHaveText('1명');         // 목장모임 = O만
  await page.click('[data-open]');
  await expect(page.locator('.detail')).toContainText('예배만 △ 1명');
  await expect(page.locator('.detail')).toContainText('결석 1명');

  await page.goto('/#check');
  const again = page.locator('.m[data-n="나하늘"]');
  await expect(again).toHaveAttribute('aria-pressed', 'mixed');   // 저장된 △가 다시 보임
  await again.click();                                             // 짧게 → 결석
  await expect(again).toHaveAttribute('aria-pressed', 'false');
});

test('비밀번호 칸에 키보드로 직접 칠 수 있다 (실제 키 입력)', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pw').pressSequentially('900000');          // 진짜 키보드처럼 한 글자씩
  expect(await page.locator('#pw').inputValue()).toBe('900000');
  await page.locator('#pw').press('Enter');                       // 엔터로 제출
  await expect(page.locator('#pwMsg')).toContainText('맞지 않아요');
  expect(await page.locator('#pw').inputValue()).toBe('');        // 틀리면 칸이 비워진다
  await page.locator('#pw').pressSequentially(EDIT_PW);
  await page.locator('#pw').press('Enter');
  await expect(page.locator('#v-dashboard')).toBeVisible();
});

test('저장하면 구글 시트에 업데이트 신호를 보내고, 연달아 저장하면 한 번으로 모은다', async ({ page, request }) => {
  await request.get('/__reset');
  await setupGroups(page);                                  // 목장 13개 저장 = 연달아 13번
  await page.waitForTimeout(3600);
  expect(await (await request.get('/__pings')).text()).toBe('1');
  await fillRoster(page, ['가목자', '나하늘']);
  await page.click('#all');
  await page.click('#submit');
  await page.waitForTimeout(3600);
  expect(Number(await (await request.get('/__pings')).text())).toBeGreaterThanOrEqual(2);
});

test('구글 시트 버튼은 새가족팀에게만 보이고 새 탭으로 열린다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#sheetLink')).toBeHidden();           // 로그인 전
  await login(page, NF_PW);
  const link = page.locator('#sheetLink');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /docs\.google\.com\/spreadsheets\/d\//);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toContainText('구글 시트');
});

for (const [who, pw] of [['목자', EDIT_PW], ['보기', VIEW_PW]]) {
  test(`${who} 권한에는 구글 시트 버튼도 링크 주소도 없다`, async ({ page }) => {
    await page.goto('/');
    await login(page, pw);
    await expect(page.locator('#v-dashboard')).toBeVisible();
    const link = page.locator('#sheetLink');
    await expect(link).toBeHidden();
    expect(await link.getAttribute('href')).toBeNull();
  });
}

test('새가족팀은 목장 출석 체크·명단 수정을 못 한다', async ({ page }) => {
  await page.goto('/');
  await login(page, NF_PW);
  await page.goto('/#check');
  await expect(page.locator('#checkBody')).toContainText('새가족팀으로 들어오셨어요');
  await expect(page.locator('#make13')).toHaveCount(0);
  await expect(page.locator('#edit')).toHaveCount(0);
});

test('연도가 바뀌면 목장을 새로 만들고, 지난 연도 목장·기록은 그대로 남는다', async ({ page }) => {
  await setupGroups(page);                                   // 올해(2026) 목장 13개
  await fillRoster(page, ['가목자', '나하늘']);
  await page.click('.m[data-n="나하늘"]');
  await page.click('#submit');
  await expect(page.locator('.gp[aria-pressed=true]')).toContainText('제출됨');
  const sunday = await page.inputValue('#date');

  // 2027년 주일로 가면 2026년 목장은 안 보이고 새로 만들 수 있다
  await page.fill('#date', '2027-01-03');
  await expect(page.locator('#make13')).toBeVisible();
  await page.click('#make13');
  await expect(page.locator('.gp')).toHaveCount(13);
  await page.click('#edit');
  await page.fill('#en', '테스트 목장');                     // 2027년 목장 이름을 같은 이름으로 바꿔도
  await page.fill('#em', '새목원');
  await page.click('#eSave');

  // 2026년으로 돌아가면 예전 명단·기록이 그대로
  await page.fill('#date', sunday);
  await page.goto('/#dashboard');
  await expect(page.locator('#rows .row')).toHaveCount(13);
  await page.click('[data-open]');
  await expect(page.locator('.detail')).toContainText('나하늘');
  await expect(page.locator('.detail')).not.toContainText('새목원');
  const demo = await page.evaluate(() => JSON.parse(localStorage.getItem('demo')));
  const ids = Object.keys(demo.groups);
  expect(ids.filter(i => i.startsWith('2027_')).length).toBe(13);  // 새해 목장은 따로 저장
  expect(ids.filter(i => /^g\d+$/.test(i) || i.startsWith('2026_')).length).toBe(13);
});

test('지난 연도는 출석·명단을 고칠 수 없다 (보기만)', async ({ page }) => {
  await page.goto('/');
  await login(page, EDIT_PW);
  await page.fill('#date', '2025-11-30');
  await page.goto('/#check');
  await expect(page.locator('#checkBody')).toContainText('지난 연도');
  await expect(page.locator('#make13')).toHaveCount(0);
  await expect(page.locator('#submit')).toHaveCount(0);
});

test('출석체크에 제출자 칸이 없다', async ({ page }) => {
  await setupGroups(page);
  await fillRoster(page, ['가목자']);
  await expect(page.locator('#by')).toHaveCount(0);
  await expect(page.locator('#checkBody')).not.toContainText('제출자');
});

test('메모는 대시보드 맨 아래에 목장별로 모여 보인다', async ({ page }) => {
  await setupGroups(page);
  await fillRoster(page, ['가목자', '나하늘']);                    // 1번째 목장 이름이 '테스트 목장'이 됨
  await page.click('#all');
  await page.fill('#memo', '가짜 기도제목: 시험 기간');
  await page.click('#submit');
  await page.click('.gp >> nth=1');                               // 2목장: 메모 없이 제출
  await page.click('#edit'); await page.fill('#em', '다소망'); await page.click('#eSave');
  await page.click('#all'); await page.click('#submit');

  await page.goto('/#dashboard');
  const memos = page.locator('#memos .memo');
  await expect(memos).toHaveCount(1);                             // 메모 남긴 목장만
  await expect(memos.first()).toContainText('테스트 목장');
  await expect(memos.first()).toContainText('가짜 기도제목: 시험 기간');
  // 메모 칸은 목장별 출석 목록보다 아래에 있다
  const rowsY = (await page.locator('#rows').boundingBox()).y;
  const memoY = (await page.locator('#memos').boundingBox()).y;
  expect(memoY).toBeGreaterThan(rowsY);
  // 목장 상세에는 메모가 중복으로 나오지 않는다
  await page.click('[data-open]');
  await expect(page.locator('.detail')).not.toContainText('가짜 기도제목');
});

test('메모가 하나도 없으면 안내 문구가 보인다', async ({ page }) => {
  await page.goto('/');
  await login(page, VIEW_PW);
  await expect(page.locator('#memos')).toContainText('메모가 없어요');
});

test('방문자 숫자 칸과 "방문자를 숫자로도 기록" 설정은 없다 (방문자는 이름으로만)', async ({ page }) => {
  await setupGroups(page);
  await fillRoster(page, ['가목자']);
  await expect(page.locator('#guestN')).toHaveCount(0);
  await page.click('#edit');
  await expect(page.locator('#ecg')).toHaveCount(0);
  await expect(page.locator('#checkBody')).not.toContainText('방문자를 숫자로도 기록');
});

test('화면 왼쪽 위 제목은 "강서성결교회 청년부 출석부"이고 Made by·연결 상태 글자는 없다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.top h1')).toHaveText('강서성결교회 청년부 출석부');
  await login(page, EDIT_PW);
  await expect(page.locator('.top h1')).toHaveText('강서성결교회 청년부 출석부');
  await expect(page.locator('body')).not.toContainText('Made by');
  await expect(page.locator('.top')).not.toContainText('연결됨');
});

/* ---------- 교인 명단 연결 ---------- */
// 체험 모드 저장소에 가짜 교인 명단을 미리 넣어요
async function seed(page, data) {
  await page.goto('/');
  await page.evaluate((d) => localStorage.setItem('demo', JSON.stringify(d)), data);
  await page.reload();
}
const FAKE_MEMBERS = {
  m_19960215_가하늘: { name: '가하늘', birthYear: 1996, hint: '가목장', status: 'active' },
  m_20010628_다은혜: { name: '다은혜', birthYear: 2001, hint: '새가족팀', status: 'active' },
  m_20050327_다은혜: { name: '다은혜', birthYear: 2005, hint: '라목장', status: 'active' },
};

test('명단 수정: 교인 명단과 연결되고, 동명이인은 목자가 골라서 저장·제출된다', async ({ page }) => {
  await seed(page, { members: FAKE_MEMBERS });
  await login(page, EDIT_PW);
  await page.goto('/#check');
  await page.click('#make13');
  await page.click('#edit');
  await page.fill('#em', '가하늘\n다은혜\n없는사람');
  await expect(page.locator('.lk.ok')).toContainText('가하늘');
  await expect(page.locator('.lk.warn')).toContainText('동명이인 2명');
  await expect(page.locator('.lk.no')).toContainText('없는사람');
  await page.selectOption('select[data-lk="다은혜"]', 'm_20050327_다은혜');
  await page.click('#eSave');
  await expect(page.locator('.m')).toHaveCount(3);
  let demo = await page.evaluate(() => JSON.parse(localStorage.getItem('demo')));
  const g = Object.values(demo.groups).find(x => x.order === 1);
  expect(g.members).toEqual([
    { name: '가하늘', isNew: false, mid: 'm_19960215_가하늘' },
    { name: '다은혜', isNew: false, mid: 'm_20050327_다은혜' },
    { name: '없는사람', isNew: false },
  ]);
  // 다시 열면 고른 사람이 그대로 선택돼 있다
  await page.click('#edit');
  await expect(page.locator('select[data-lk="다은혜"]')).toHaveValue('m_20050327_다은혜');
  await page.click('#eCancel');
  // 제출하면 이름 → 교인 id 가 함께 저장된다
  await page.click('.m[data-n="가하늘"]');
  await page.click('.m[data-n="다은혜"]');
  await page.click('#submit');
  await expect(page.locator('.gp[aria-pressed=true]')).toContainText('제출됨');
  demo = await page.evaluate(() => JSON.parse(localStorage.getItem('demo')));
  const rec = Object.values(demo.att)[0];
  expect(rec.ids).toEqual({ 가하늘: 'm_19960215_가하늘', 다은혜: 'm_20050327_다은혜' });
});

test('보기·목자 권한은 연락처(전화번호)를 읽을 수 없다', async ({ page }) => {
  await seed(page, { members: FAKE_MEMBERS, contacts: { m_19960215_가하늘: { phone: '010-9999-1111' } } });
  for (const pw of [EDIT_PW, VIEW_PW]) {
    await page.goto('/');
    await login(page, pw);
    await expect(page.locator('#v-dashboard')).toBeVisible();
    for (const h of ['#dashboard', '#check', '#welcome']) {
      await page.goto('/' + h);
      expect(await page.locator('body').innerText()).not.toContain('010-9999-1111');
    }
    const err = await page.evaluate(async () => { try { await window.__store.getContact('m_19960215_가하늘'); return 'read'; } catch (e) { return e.code; } });
    expect(err).toBe('permission-denied');
    await page.evaluate(() => window.__store.logout());
  }
});

/* ---------- 새가족팀 페이지 ---------- */
const FAKE_CONTACTS = { m_19960215_가하늘: { phone: '010-1234-5678', address: '가짜시 가짜동 1', birth: '1996-02-15', memo: '' } };

test('새가족 탭은 새가족팀에게만 보인다', async ({ page }) => {
  await page.goto('/');
  await login(page, EDIT_PW);
  await expect(page.locator('#tabWelcome')).toBeHidden();
  await page.goto('/#welcome');
  await expect(page.locator('#welcomeBody')).toContainText('새가족팀 전용');
  await expect(page.locator('#ws')).toHaveCount(0);
});

test('새가족팀: 이름 검색 → 출석 → 취소, 인원 수가 바로 바뀐다', async ({ page }) => {
  await seed(page, { members: FAKE_MEMBERS, contacts: FAKE_CONTACTS });
  await login(page, NF_PW);
  await expect(page.locator('#tabWelcome')).toBeVisible();
  await page.click('#tabWelcome');
  await page.fill('#ws', '은혜');
  await expect(page.locator('#wRes .wr')).toHaveCount(2);                     // 동명이인 둘 다, 출생연도로 구분
  await expect(page.locator('#wRes')).toContainText('01년생');
  await expect(page.locator('#wRes')).toContainText('05년생');
  await page.click('#wRes [data-chk="m_20050327_다은혜"]');
  await expect(page.locator('#wN')).toHaveText('1');
  await expect(page.locator('#wChk')).toContainText('다은혜');
  await page.click('#wChk [data-chk="m_20050327_다은혜"]');                  // 취소
  await expect(page.locator('#wN')).toHaveText('0');
  await page.fill('#ws', '없는이름');
  await expect(page.locator('#wRes')).toContainText('새가족 등록');
});

test('새가족팀: 이름을 누르면 전화번호(바로 걸기)·주소가 보인다', async ({ page }) => {
  await seed(page, { members: FAKE_MEMBERS, contacts: FAKE_CONTACTS });
  await login(page, NF_PW);
  await page.goto('/#welcome');
  await page.fill('#ws', '가하늘');
  await page.click('#wRes [data-card="m_19960215_가하늘"]');
  await expect(page.locator('#wCard a.tel')).toHaveAttribute('href', 'tel:01012345678');
  await expect(page.locator('#wCard')).toContainText('가짜시 가짜동 1');
});

test('새가족 등록: 전화번호 필수, 등록하면 명단·연락처에 저장되고 오늘 출석도 체크, 중복 등록은 막힘', async ({ page }) => {
  await seed(page, { members: FAKE_MEMBERS });
  await login(page, NF_PW);
  await page.goto('/#welcome');
  await page.click('#wRegBtn');
  await page.fill('#rName', '신소망');
  await page.fill('#rBirth', '2003-04-05');
  await page.click('#rSave');
  await expect(page.locator('#rMsg')).toContainText('전화번호');
  await page.fill('#rPhone', '1055556666');                                   // 앞 0 없이 써도
  await page.fill('#rAddr', '가짜구 가짜로 2');
  await page.click('#rSave');
  await expect(page.locator('#wN')).toHaveText('1');
  const demo = await page.evaluate(() => JSON.parse(localStorage.getItem('demo')));
  expect(demo.members['m_20030405_신소망']).toMatchObject({ name: '신소망', birthYear: 2003, isNew: true, status: 'active' });
  expect(demo.members['m_20030405_신소망'].phone).toBeUndefined();          // 모두가 보는 명단엔 전화번호 없음
  expect(demo.contacts['m_20030405_신소망']).toMatchObject({ phone: '010-5555-6666', address: '가짜구 가짜로 2', birth: '2003-04-05' });
  // 같은 사람 다시 등록 → 막힘
  await page.click('#wRegBtn');
  await page.fill('#rName', '신소망');
  await page.fill('#rBirth', '2003-04-05');
  await page.fill('#rPhone', '010-5555-6666');
  await page.click('#rSave');
  await expect(page.locator('#rMsg')).toContainText('이미 등록된');
});

test('새가족팀: 지난 연도는 출석 체크·등록을 할 수 없다', async ({ page }) => {
  await seed(page, { members: FAKE_MEMBERS });
  await login(page, NF_PW);
  await page.fill('#date', '2025-11-30');
  await page.goto('/#welcome');
  await expect(page.locator('#welcomeBody')).toContainText('지난 연도');
  await expect(page.locator('#wRegBtn')).toHaveCount(0);
  await page.fill('#ws', '가하늘');
  await expect(page.locator('#wRes [data-chk]')).toHaveCount(0);
});
