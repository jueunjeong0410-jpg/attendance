/* 청년부 출석 계산 (앱과 구글 시트 스크립트가 함께 써요)
 * - 앱: index.html이 이 파일을 불러와요.
 * - 시트: Apps Script 프로젝트에 'report' 파일로 같은 내용을 넣어 둬요. (이 파일을 고치면 그쪽도 같이 바꿔 주세요)
 * 화면·시트·Firebase와 무관한 순수 계산이라 tests/report.spec.mjs에서 검사해요.
 *
 * 공식 출석 = 목자 체크(O·△)와 새가족팀 체크 중 한 곳이라도 체크한 사람(합집합).
 * 사람 비교는 교인 id(mid)로 해요. 교인 명단과 연결 안 된 이름은 '목장id|이름'으로 따로 셉니다.
 */
var LEGACY_GROUP_YEAR = 2026;
function rptGroupYear(g) { return Number(g.year) || LEGACY_GROUP_YEAR; }

// 이름 → 교인 id: 교인 명단에 그 이름이 딱 한 명일 때만 (동명이인은 목자가 명단 수정에서 골라야 해요)
function uniqueNames(members) {
  var cnt = {}, id = {};
  (members || []).forEach(function (m) { if ((m.status || 'active') === 'left') return; cnt[m.name] = (cnt[m.name] || 0) + 1; id[m.name] = m.id; });
  var out = {};
  Object.keys(cnt).forEach(function (n) { if (cnt[n] === 1) out[n] = id[n]; });
  return out;
}
// 목장 명단의 사람 → 교인 id (목자가 연결한 id가 먼저, 없으면 하나뿐인 이름으로)
function rosterMid(m, uniq) { return m.mid || (uniq && uniq[m.name]) || ''; }

// 대조: 한 주일의 목장 기록(attMap: 목장id → 기록)과 새가족팀 체크(checkedMap: 교인id → {name})
// members(선택): 교인 명단. 주면 목장 명단에서 아직 연결 안 된 이름도 하나뿐인 이름이면 같은 사람으로 봐요
function reconcile(gs, attMap, checkedMap, members) {
  checkedMap = checkedMap || {};
  var uniq = members ? uniqueNames(members) : null;
  var where = {}, shep = {}, unlinked = [];
  gs.forEach(function (g) { (g.members || []).forEach(function (m) { var id = rosterMid(m, uniq); if (id) where[id] = g; }); });
  gs.forEach(function (g) {
    var r = attMap[g.id]; if (!r) return;
    var roster = {};
    (g.members || []).forEach(function (m) { var id = rosterMid(m, uniq); if (id) roster[m.name] = id; });
    if (uniq) Object.keys(uniq).forEach(function (n) { if (!roster[n]) roster[n] = uniq[n]; });   // 명단에서 빠졌지만 기록에 남은 이름
    [].concat(r.present || [], r.worship || []).forEach(function (n) {
      var mid = (r.ids || {})[n] || roster[n];
      if (mid) shep[mid] = { name: n, g: g }; else unlinked.push({ name: n, g: g });
    });
  });
  var out = { both: [], shepMiss: [], nfMiss: [], noGroup: [], notSubmitted: [], unlinked: unlinked };
  Object.keys(checkedMap).forEach(function (mid) {
    var v = checkedMap[mid];
    if (shep[mid]) { out.both.push({ mid: mid, name: v.name, g: shep[mid].g }); return; }
    var g = where[mid];
    if (!g) { out.noGroup.push({ mid: mid, name: v.name }); return; }
    if (!attMap[g.id]) { out.notSubmitted.push({ mid: mid, name: v.name, g: g }); return; }
    out.shepMiss.push({ mid: mid, name: v.name, g: g });
  });
  Object.keys(shep).forEach(function (mid) { if (!checkedMap[mid]) out.nfMiss.push({ mid: mid, name: shep[mid].name, g: shep[mid].g }); });
  out.official = out.both.length + out.shepMiss.length + out.noGroup.length + out.notSubmitted.length + out.nfMiss.length + unlinked.length;
  return out;
}

// 분기: 2026-Q4 → 2026-10-01 ~ 2026-12-31
function quarterOf(date) { return date.slice(0, 4) + '-Q' + (Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1); }
function quarterRange(q) {
  var y = q.slice(0, 4), n = Number(q.slice(-1)), m1 = (n - 1) * 3 + 1, m3 = m1 + 2;
  var last = [31, (Number(y) % 4 === 0 && (Number(y) % 100 !== 0 || Number(y) % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m3 - 1];
  var p = function (x) { return (x < 10 ? '0' : '') + x; };
  return { from: y + '-' + p(m1) + '-01', to: y + '-' + p(m3) + '-' + last };
}
function prevQuarter(q) { var y = Number(q.slice(0, 4)), n = Number(q.slice(-1)); return n === 1 ? (y - 1) + '-Q4' : y + '-Q' + (n - 1); }
function quarterLabel(q) { return q.slice(0, 4) + '년 ' + q.slice(-1) + '분기'; }

/* 분기 통계
 * groups: 모든 목장(연도 섞여도 됨), records: 목장 출석 기록, welcomes: 새가족팀 출석 문서, members: 교인 명단
 * 결과: 주일별 추이, 평균, 방문자, 새가족, 목장별 출석률, 4주 연속 결석자
 */
function quarterStats(q, groups, records, welcomes, members) {
  var R = quarterRange(q), year = Number(q.slice(0, 4));
  var gs = groups.filter(function (g) { return rptGroupYear(g) === year; })
    .sort(function (a, b) { return (a.order == null ? 99 : a.order) - (b.order == null ? 99 : b.order); });
  var inQ = function (d) { return d >= R.from && d <= R.to; };
  var recs = records.filter(function (r) { return r.date && inQ(r.date); });
  var wel = {};
  welcomes.forEach(function (w) { if (w.date && inQ(w.date)) wel[w.date] = w.checked || {}; });
  var dates = {};
  recs.forEach(function (r) { dates[r.date] = true; });
  Object.keys(wel).forEach(function (d) { if (Object.keys(wel[d]).length) dates[d] = true; });
  dates = Object.keys(dates).sort();

  var weeks = dates.map(function (d) {
    var attMap = {}, O = 0, guests = 0;
    recs.forEach(function (r) { if (r.date === d) { attMap[r.gid] = r; O += (r.present || []).length; guests += (r.guests || []).length; } });
    var rc = reconcile(gs, attMap, wel[d] || {}, members);
    // 이 주일에 출석한 사람 열쇠(교인 id 또는 목장id|이름)
    var came = {};
    rc.both.concat(rc.shepMiss, rc.noGroup, rc.notSubmitted, rc.nfMiss).forEach(function (x) { came[x.mid] = true; });
    rc.unlinked.forEach(function (x) { came[x.g.id + '|' + x.name] = true; });
    return { date: d, official: rc.official, group: O, guests: guests, came: came, attMap: attMap };
  });
  var sum = function (k) { return weeks.reduce(function (a, w) { return a + w[k]; }, 0); };
  var avg = function (k) { return weeks.length ? Math.round(sum(k) / weeks.length * 10) / 10 : 0; };

  // 새가족: 처음 온 날(없으면 등록일)이 이번 분기인 새가족, 그중 3번 이상 출석
  var newcomers = (members || []).filter(function (m) { var d = m.firstVisit || (m.isNew ? m.registeredAt : ''); return m.isNew && d && inQ(d); });
  var settled = newcomers.filter(function (m) { return weeks.filter(function (w) { return w.came[m.id]; }).length >= 3; });

  // 목장별 출석률 = 제출한 주의 (O+△) ÷ (O+△+X)
  var groupRates = gs.map(function (g) {
    var c = 0, t = 0, n = 0;
    recs.forEach(function (r) {
      if (r.gid !== g.id) return;
      n++; var k = (r.present || []).length + (r.worship || []).length;
      c += k; t += k + (r.absent || []).length;
    });
    return { gid: g.id, name: g.name, rate: t ? Math.round(c / t * 100) : null, weeks: n };
  });

  // 4주 연속 결석: 올해 목장 명단에 있는 사람 중 분기 마지막 4번의 주일에 한 번도 체크되지 않은 사람
  var last4 = weeks.slice(-4), absent4 = [];
  if (last4.length === 4) {
    gs.forEach(function (g) {
      var uniq = uniqueNames(members);
      (g.members || []).forEach(function (m) {
        var key = rosterMid(m, uniq) || (g.id + '|' + m.name);
        if (last4.every(function (w) { return !w.came[key]; })) absent4.push({ name: m.name, group: g.name, mid: m.mid || '' });
      });
    });
  }
  var roster = gs.reduce(function (a, g) { return a + (g.members || []).length; }, 0);
  var officials = weeks.map(function (w) { return w.official; });
  return {
    q: q, label: quarterLabel(q), from: R.from, to: R.to, sundays: weeks.length, roster: roster,
    avgOfficial: avg('official'), avgGroup: avg('group'),
    maxOfficial: officials.length ? Math.max.apply(null, officials) : 0,
    minOfficial: officials.length ? Math.min.apply(null, officials) : 0,
    guests: sum('guests'), avgGuests: avg('guests'),
    newcomers: newcomers.length, settled: settled.length,
    weekly: weeks.map(function (w) { return { date: w.date, official: w.official, group: w.group }; }),
    groupRates: groupRates, absent4: absent4
  };
}

// 기록이 있는 분기 목록 (오래된 것부터)
function quartersWithData(records, welcomes) {
  var qs = {};
  records.forEach(function (r) { if (r.date) qs[quarterOf(r.date)] = true; });
  welcomes.forEach(function (w) { if (w.date && Object.keys(w.checked || {}).length) qs[quarterOf(w.date)] = true; });
  return Object.keys(qs).sort();
}

if (typeof module !== 'undefined') module.exports = { uniqueNames: uniqueNames, reconcile: reconcile, quarterStats: quarterStats, quarterOf: quarterOf, quarterRange: quarterRange, prevQuarter: prevQuarter, quartersWithData: quartersWithData, quarterLabel: quarterLabel };
