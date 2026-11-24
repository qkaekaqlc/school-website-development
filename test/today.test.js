const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { pool, query, neis, neisCalls, reset, student, login } = require('./_helpers');

before(reset);
after(() => pool.end());

let mid, high;

test('가입할 때 교육청 코드가 저장된다', async () => {
  mid = await student('middle1');
  high = await student('high1', 'H1');
  const rows = await query('SELECT neis_code, office_code FROM schools ORDER BY neis_code');
  assert.deepStrictEqual(rows, [{ neis_code: 'H1', office_code: 'B10' }, { neis_code: 'M1', office_code: 'B10' }]);
});

test('오늘 급식을 알레르기 번호 없이 보여 준다', async () => {
  neis.mealServiceDietInfo = [{ MMEAL_SC_NM: '중식', DDISH_NM: '쌀밥 (5.6.)<br/>배추김치 (9.13.)<br/>불고기' }];
  const html = (await mid.get('/today').expect(200)).text;
  assert.match(html, /중식<\/b><br>쌀밥, 배추김치, 불고기/);
  const url = new URL(neisCalls.findLast(u => u.includes('mealServiceDietInfo')));
  assert.strictEqual(url.searchParams.get('ATPT_OFCDC_SC_CODE'), 'B10');
  assert.strictEqual(url.searchParams.get('SD_SCHUL_CODE'), 'M1');
  assert.match(url.searchParams.get('MLSV_YMD'), /^\d{8}$/);
});

test('학년과 반을 입력해야 시간표가 보인다', async () => {
  assert.match((await mid.get('/today')).text, /학년과 반을 입력하면/);
  await mid.post('/me/class').type('form').send({ grade: '4', class_nm: '1' }).expect(400);
  await mid.post('/me/class').type('form').send({ grade: '2', class_nm: '3' }).expect(302);
  neis.misTimetable = [{ PERIO: '2', ITRT_CNTNT: '수학' }, { PERIO: '1', ITRT_CNTNT: '국어' }];
  const html = (await mid.get('/today')).text;
  assert.match(html, /1교시<\/b> 국어<\/li><li><b>2교시<\/b> 수학/);
  const url = new URL(neisCalls.findLast(u => u.includes('Timetable')));
  assert.match(url.pathname, /misTimetable$/);
  assert.strictEqual(url.searchParams.get('GRADE'), '2');
  assert.strictEqual(url.searchParams.get('CLASS_NM'), '3');
});

test('고등학생은 고등학교 시간표 API를 쓴다', async () => {
  await high.post('/me/class').type('form').send({ grade: '1', class_nm: '5' }).expect(302);
  neis.hisTimetable = [{ PERIO: '1', ITRT_CNTNT: '영어' }];
  assert.match((await high.get('/today')).text, /1교시<\/b> 영어/);
  assert.match(neisCalls.findLast(u => u.includes('Timetable')), /hisTimetable/);
});

test('급식 정보가 없거나 나이스 오류가 나면 안내 문구를 보여 준다', async () => {
  delete neis.mealServiceDietInfo;
  assert.match((await mid.get('/today')).text, /오늘은 급식 정보가 없어요/);
  const realFetch = global.fetch;
  global.fetch = async () => { throw new Error('network'); };
  try { assert.match((await mid.get('/today')).text, /불러오지 못했어요/); }
  finally { global.fetch = realFetch; }
});

test('관리자는 학교가 없어서 전체 게시판으로 보낸다', async () => {
  const admin = await login('admin', 'adminpass1');
  await admin.get('/today').expect(302).expect('Location', '/board/all');
});
