/**
 * 청년부 출석 → 구글 시트 자동 기록 (Google Apps Script)
 *
 * 하는 일: 앱(Firebase)에 저장된 출석 기록을 읽어서 연도별 시트('2026 출석현황' 등)에 월별 표로 적어요.
 *   - 왼쪽: A열 목장, B열 이름 (고정)
 *   - 오른쪽: 월별 표가 이어지고, 달과 달 사이는 한 열 비워요
 *   - O = 목장모임까지 참석, △ = 예배만, X = 결석, 빈칸 = 그 주 기록 없음
 *   - 맨 위 3번째 줄: 날짜별 총 참석(O+△), 4번째 줄: 날짜별 방문자 수 합계
 *
 * 설정 (코드에는 비밀번호를 적지 않아요):
 *   Apps Script 왼쪽 톱니바퀴(프로젝트 설정) → 스크립트 속성에 4개를 넣어 주세요.
 *     FIREBASE_API_KEY     Firebase 웹 설정의 apiKey
 *     FIREBASE_PROJECT_ID  Firebase 웹 설정의 projectId
 *     VIEWER_EMAIL         보기 계정 이메일 (예: viewer@youth.app)
 *     VIEWER_PASSWORD      보기 계정 비밀번호
 *
 * 주의: 연도별 출석현황 시트는 업데이트할 때마다 새로 그려져요. 이 시트에 직접 적은 내용은 지워져요.
 */

var SHEET_NAME = '출석현황';   // 연도별 시트 이름: '2026 출석현황' 처럼 앞에 연도가 붙어요
var FIRST_DATA_COL = 2;   // 0부터 셈: 0=A(목장), 1=B(이름), 2=C부터 날짜
var HEADER_ROWS = 4;      // 1줄: 월, 2줄: 날짜, 3줄: 총 참석, 4줄: 방문자 수

/* ---------- 메뉴 ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('출석')
    .addItem('지금 업데이트', 'updateAttendanceSheet')
    .addItem('1시간마다 자동 업데이트 켜기', 'turnOnHourlyUpdate')
    .addToUi();
}

function turnOnHourlyUpdate() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'updateAttendanceSheet'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('updateAttendanceSheet').timeBased().everyHours(1).create();
  SpreadsheetApp.getActive().toast('1시간마다 자동으로 업데이트돼요.', '출석');
}

/* ---------- 실행 ---------- */
function updateAttendanceSheet() {
  var p = PropertiesService.getScriptProperties().getProperties();
  ['FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID', 'VIEWER_EMAIL', 'VIEWER_PASSWORD'].forEach(function (k) {
    if (!p[k]) throw new Error('스크립트 속성에 ' + k + ' 값이 없어요.');
  });
  var token = signIn_(p);
  var groups = listDocs_(p, token, 'groups');
  var records = listDocs_(p, token, 'attendance');
  var thisYear = Number(Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy'));
  var ss = SpreadsheetApp.getActive();
  // 예전 '출석현황' 시트가 있으면 지우지 않고 올해 시트 이름으로 바꿔 써요
  var old = ss.getSheetByName(SHEET_NAME);
  if (old && !ss.getSheetByName(sheetNameForYear(thisYear))) old.setName(sheetNameForYear(thisYear));
  yearsToWrite(records, thisYear).forEach(function (y, i) {
    var yearRecords = records.filter(function (r) { return String(r.date || '').slice(0, 4) === String(y); });
    var sh = writeSheet_(buildGrid(groups, yearRecords, y + '년 청년부 출석'), sheetNameForYear(y));
    ss.setActiveSheet(sh); ss.moveActiveSheet(i + 1);   // 최신 연도가 맨 앞
  });
}

/* ---------- 연도별 시트 ---------- */
function sheetNameForYear(y) { return y + ' ' + SHEET_NAME; }

// 기록이 있는 연도 + 올해(기록이 없어도 빈 표를 만들어 둠), 최신 연도부터
function yearsToWrite(records, thisYear) {
  var ys = {}; ys[thisYear] = true;
  records.forEach(function (r) { var y = Number(String(r.date || '').slice(0, 4)); if (y) ys[y] = true; });
  return Object.keys(ys).map(Number).sort(function (a, b) { return b - a; });
}

/* ---------- 앱에서 저장하면 바로 업데이트 (웹 앱 신호) ----------
 * 앱이 출석·명단을 저장한 직후 이 스크립트의 웹 앱 주소로 "업데이트해 줘" 신호만 보내요.
 * 신호에는 데이터가 전혀 없고, 시트는 언제나 Firebase에서 직접 읽어 와요.
 * 그래서 누가 이 주소를 알아도 할 수 있는 일은 '시트 새로고침'뿐이에요.
 * 여러 목장이 동시에 제출해도 한 번에 하나씩 차례로 처리해요(잠금).
 */
function doPost(e) { return runUpdateSafely_(); }
function doGet(e) { return runUpdateSafely_(); }

function runUpdateSafely_() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return ContentService.createTextOutput('busy');
  try {
    updateAttendanceSheet();
    return ContentService.createTextOutput('ok');
  } catch (err) {
    // 오류를 숨기지 않고 다시 던져서, Apps Script '실행' 기록에 '실패'로 보이게 해요
    console.error(err);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Firebase 읽기 ---------- */
function signIn_(p) {
  var res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + encodeURIComponent(p.FIREBASE_API_KEY), {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ email: p.VIEWER_EMAIL, password: p.VIEWER_PASSWORD, returnSecureToken: true })
    });
  if (res.getResponseCode() !== 200) throw new Error('Firebase 로그인 실패: 보기 계정 이메일·비밀번호를 확인해 주세요.');
  return JSON.parse(res.getContentText()).idToken;
}

function listDocs_(p, token, collection) {
  var out = [], pageToken = '';
  do {
    var url = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(p.FIREBASE_PROJECT_ID) +
      '/databases/(default)/documents/' + collection + '?pageSize=300' +
      (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error(collection + ' 읽기 실패 (코드 ' + res.getResponseCode() + ')');
    var body = JSON.parse(res.getContentText());
    (body.documents || []).forEach(function (d) {
      var o = fromFields_(d.fields || {});
      if (!o.id) o.id = d.name.split('/').pop();
      out.push(o);
    });
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

// Firestore가 주는 {stringValue: ...} 형식을 보통 값으로 바꿔요
function fromValue_(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue_);
  if ('mapValue' in v) return fromFields_(v.mapValue.fields || {});
  return null;
}
function fromFields_(f) {
  var o = {};
  Object.keys(f).forEach(function (k) { o[k] = fromValue_(f[k]); });
  return o;
}

/* ---------- 표 만들기 (시트와 무관한 순수 계산: 테스트 대상) ---------- */
function sundaysOfMonth_(ym) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1, out = [];
  for (var d = 1; d <= 31; d++) {
    var dt = new Date(Date.UTC(y, m, d));
    if (dt.getUTCMonth() !== m) break;
    if (dt.getUTCDay() === 0) out.push(ym + '-' + (d < 10 ? '0' : '') + d);
  }
  return out;
}

function buildGrid(groups, records, title) {
  var sorted = groups.slice().sort(function (a, b) {
    var oa = a.order == null ? 99 : a.order, ob = b.order == null ? 99 : b.order;
    return oa - ob || String(a.name).localeCompare(String(b.name), 'ko', { numeric: true });
  });

  // 기록 찾기: byKey[날짜|목장id]
  var byKey = {}, lastDate = '';
  records.forEach(function (r) {
    if (!r.date || !r.gid) return;
    byKey[r.date + '|' + r.gid] = r;
    if (r.date > lastDate) lastDate = r.date;
  });

  // 행: 목장 순서대로 현재 명단 + (명단에서 빠졌지만 기록에 있는 사람)
  var rows = [], seenGroup = {};
  function addGroup(gid, name, roster) {
    seenGroup[gid] = true;
    var names = roster.slice(), have = {};
    names.forEach(function (n) { have[n] = true; });
    records.forEach(function (r) {
      if (r.gid !== gid) return;
      [].concat(r.present || [], r.worship || [], r.absent || []).forEach(function (n) {
        if (!have[n]) { have[n] = true; names.push(n); }
      });
    });
    names.forEach(function (n) { rows.push({ gid: gid, group: name, name: n }); });
  }
  sorted.forEach(function (g) {
    addGroup(g.id, g.name, (g.members || []).map(function (m) { return m.name; }));
  });
  // 삭제된 목장이라도 기록이 있으면 아래에 남겨요
  records.forEach(function (r) {
    if (r.gid && !seenGroup[r.gid]) addGroup(r.gid, (r.groupName || '삭제된 목장') + ' (삭제됨)', []);
  });

  // 열: 기록이 있는 달마다 그 달의 주일 + (주일이 아닌 날 기록), 마지막 기록 날짜까지
  var months = {};
  records.forEach(function (r) { if (r.date) months[r.date.slice(0, 7)] = true; });
  var blocks = Object.keys(months).sort().map(function (ym) {
    var dates = {};
    sundaysOfMonth_(ym).forEach(function (d) { if (d <= lastDate) dates[d] = true; });
    records.forEach(function (r) { if (r.date && r.date.slice(0, 7) === ym) dates[r.date] = true; });
    return { ym: ym, dates: Object.keys(dates).sort() };
  });

  var width = FIRST_DATA_COL;
  blocks.forEach(function (b, i) { b.col = width; width += b.dates.length + (i < blocks.length - 1 ? 1 : 0); });

  var header1 = new Array(width).fill(''), header2 = new Array(width).fill(''), header3 = new Array(width).fill(''), header4 = new Array(width).fill('');
  header1[0] = title || '청년부 출석현황'; header2[0] = '목장'; header2[1] = '이름';
  header3[0] = '전체'; header3[1] = '총 참석';
  header4[0] = '전체'; header4[1] = '방문자 수';
  blocks.forEach(function (b) {
    header1[b.col] = b.ym.slice(0, 4) + '년 ' + Number(b.ym.slice(5, 7)) + '월';
    b.dates.forEach(function (d, j) {
      header2[b.col + j] = Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10));
      // 총 참석 = 그날 제출된 모든 목장의 O + △ (방문자는 빼고, 대시보드 숫자와 같아요)
      // 방문자 수 = 그날 모든 목장이 적은 방문자 이름 수의 합계
      var total = 0, guests = 0, any = false;
      records.forEach(function (r) {
        if (r.date !== d) return;
        any = true; total += (r.present || []).length + (r.worship || []).length;
        guests += (r.guests || []).length;
      });
      header3[b.col + j] = any ? total : '';
      header4[b.col + j] = any ? guests : '';
    });
  });

  var values = [header1, header2, header3, header4];
  rows.forEach(function (row) {
    var line = new Array(width).fill('');
    line[0] = row.group; line[1] = row.name;
    blocks.forEach(function (b) {
      b.dates.forEach(function (d, j) {
        var r = byKey[d + '|' + row.gid];
        if (!r) return;
        if ((r.present || []).indexOf(row.name) >= 0) line[b.col + j] = 'O';
        else if ((r.worship || []).indexOf(row.name) >= 0) line[b.col + j] = '△';
        else if ((r.absent || []).indexOf(row.name) >= 0) line[b.col + j] = 'X';
      });
    });
    values.push(line);
  });

  // 같은 목장이 이어지는 행 묶음 (A열 병합용). start는 values 안의 행 번호(0부터)
  var groupRuns = [];
  rows.forEach(function (row, i) {
    var last = groupRuns[groupRuns.length - 1];
    if (last && last.gid === row.gid) last.span++;
    else groupRuns.push({ gid: row.gid, start: i + HEADER_ROWS, span: 1 });
  });

  return {
    values: values, width: width,
    months: blocks.map(function (b) { return { col: b.col, span: b.dates.length, title: header1[b.col] }; }),
    groupRuns: groupRuns.map(function (g) { return { start: g.start, span: g.span }; })
  };
}

/* ---------- 시트에 쓰기 ---------- */
function writeSheet_(grid, sheetName) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sh.clear(); sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  // 고정된 줄과 고정 안 된 줄은 병합할 수 없어서, 먼저 고정을 풀고 맨 끝에 다시 고정해요
  sh.setFrozenRows(0); sh.setFrozenColumns(0);

  var v = grid.values, rows = v.length, cols = Math.max(grid.width, 2);
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());
  sh.getRange(1, 1, rows, cols).setValues(v);

  sh.getRange(1, 2).setValue('업데이트 ' + Utilities.formatDate(new Date(), 'Asia/Seoul', 'M/d HH:mm')).setFontColor('#5b6b62');
  sh.getRange(1, 1).setFontWeight('bold');
  grid.months.forEach(function (m) {
    var r = sh.getRange(1, m.col + 1, 1, m.span);
    if (m.span > 1) r.merge();
    r.setHorizontalAlignment('center').setFontWeight('bold').setBackground('#1f5c3f').setFontColor('#ffffff');
  });
  sh.getRange(2, 1, 1, cols).setFontWeight('bold').setBackground('#f3f6f2').setHorizontalAlignment('center');
  sh.getRange(3, 1, 1, cols).setFontWeight('bold').setBackground('#cfe6d6').setFontColor('#1f5c3f').setHorizontalAlignment('center');
  sh.getRange(4, 1, 1, cols).setFontWeight('bold').setBackground('#fff4dd').setFontColor('#8a5a00').setHorizontalAlignment('center');
  sh.getRange(3, 1, 2, 1).merge().setVerticalAlignment('middle');   // A3:A4 '전체' 한 칸
  // 같은 목장명은 A열에서 세로로 합쳐서 보기 편하게
  grid.groupRuns.forEach(function (g) {
    var r = sh.getRange(g.start + 1, 1, g.span, 1);
    if (g.span > 1) r.merge();
    r.setVerticalAlignment('middle').setHorizontalAlignment('center').setFontWeight('bold');
  });
  sh.setFrozenRows(HEADER_ROWS); sh.setFrozenColumns(2);
  sh.setColumnWidth(1, 110); sh.setColumnWidth(2, 80);
  if (cols > 2) sh.setColumnWidths(3, cols - 2, 46);

  if (rows > HEADER_ROWS && cols > 2) {
    var data = sh.getRange(HEADER_ROWS + 1, 3, rows - HEADER_ROWS, cols - 2);
    data.setHorizontalAlignment('center');
    var rule = function (text, bg, fg) {
      return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setFontColor(fg).setRanges([data]).build();
    };
    sh.setConditionalFormatRules([rule('O', '#cfe6d6', '#1f5c3f'), rule('△', '#fff4dd', '#8a5a00'), rule('X', '#fbe3dc', '#b3402a')]);
  }
  return sh;
}
