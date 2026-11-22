// 청년부 출석 앱 핵심 기능 테스트
// - 모든 테스트는 '체험 모드'(브라우저 안에만 저장)로 돌고, 이름은 전부 가짜입니다.
// - 1234 / 0000은 체험 모드 전용 비밀번호이며 실제 서비스 비밀번호가 아닙니다.
import { test, expect } from '@playwright/test';

const EDIT_PW = '1234';
const VIEW_PW = '0000';

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

test('대시보드에 구글 시트 바로가기 버튼이 있고 새 탭으로 열린다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#sheetLink')).toBeHidden();           // 로그인 전에는 안 보임
  await login(page, VIEW_PW);
  const link = page.locator('#sheetLink');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /docs\.google\.com\/spreadsheets\/d\//);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toContainText('구글 시트');
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
