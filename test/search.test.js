const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { pool, query, reset, student, writePost } = require('./_helpers');

before(reset);
after(() => pool.end());

let a, b, c;

test('게시판에서 제목과 내용으로 검색한다', async () => {
  a = await student('alice'); b = await student('bobby', 'H1'); c = await student('carol');
  await writePost(a, 'all', '수학 시험 범위', '몇 쪽까지야?');
  await writePost(a, 'all', '점심 메뉴', '오늘 수학 선생님이 ...');
  await writePost(a, 'all', '체육대회', '언제 해?');
  const html = (await b.get('/board/all?q=' + encodeURIComponent('수학'))).text;
  assert.match(html, /수학 시험 범위/);
  assert.match(html, /점심 메뉴/);       // 내용에 있음
  assert.doesNotMatch(html, /체육대회/);
  assert.match((await b.get('/board/all?q=' + encodeURIComponent('없는말'))).text, /검색 결과가 없어요/);
});

test('검색해도 다른 학교 게시판 글은 나오지 않는다', async () => {
  await writePost(a, 'school', '우리 학교 수학');
  assert.doesNotMatch((await b.get('/board/school?q=' + encodeURIComponent('수학'))).text, /우리 학교 수학/);
  assert.doesNotMatch((await b.get('/board/all?q=' + encodeURIComponent('수학'))).text, /우리 학교 수학/);
  assert.match((await c.get('/board/school?q=' + encodeURIComponent('수학'))).text, /우리 학교 수학/);
});

test('검색어의 %와 _는 글자 그대로 찾는다', async () => {
  await writePost(a, 'all', '할인 50%', '내용');
  const html = (await b.get('/board/all?q=' + encodeURIComponent('%'))).text;
  assert.match(html, /할인 50%/);
  assert.doesNotMatch(html, /체육대회/);
});

test('내 정보에서 내가 쓴 글과 댓글만 모아 본다', async () => {
  const id = await writePost(c, 'all', '캐롤의 글');
  await c.post(`/post/${id}/comment`).type('form').send({ body: '캐롤의 댓글' }).expect(302);
  await a.post(`/post/${id}/comment`).type('form').send({ body: '앨리스의 댓글' }).expect(302);
  const deleted = await writePost(c, 'all', '지운 글');
  await c.post(`/post/${deleted}/delete`).expect(302);

  const html = (await c.get('/me')).text;
  assert.match(html, /캐롤의 글/);
  assert.match(html, /캐롤의 댓글/);
  assert.doesNotMatch(html, /앨리스의 댓글|수학 시험 범위|지운 글/);
});
