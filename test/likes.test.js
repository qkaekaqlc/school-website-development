const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { pool, query, reset, student, writePost } = require('./_helpers');

before(reset);
after(() => pool.end());

let a, b, c, postId;

test('좋아요는 한 번만, 다시 누르면 취소된다', async () => {
  a = await student('alice'); b = await student('bobby', 'H1'); c = await student('carol');
  postId = await writePost(a, 'all', '좋아요 테스트');
  await b.post(`/post/${postId}/like`).expect(302);
  assert.match((await b.get(`/post/${postId}`)).text, /♥ 좋아요 1/);
  await b.post(`/post/${postId}/like`).expect(302);
  assert.match((await b.get(`/post/${postId}`)).text, /♡ 좋아요 0/);
});

test('내 글과 내 댓글에는 좋아요를 누를 수 없다', async () => {
  await a.post(`/post/${postId}/like`).expect(400);
  await a.post(`/post/${postId}/comment`).type('form').send({ body: '댓글' }).expect(302);
  const [{ id }] = await query('SELECT id FROM comments ORDER BY id DESC LIMIT 1');
  await a.post(`/comment/${id}/like`).expect(400);
  await c.post(`/comment/${id}/like`).expect(302);
  assert.match((await c.get(`/post/${postId}`)).text, /♥ 1/);
});

test('다른 학교 게시판 글에는 좋아요를 누를 수 없다', async () => {
  const id = await writePost(a, 'school', '우리 학교');
  await b.post(`/post/${id}/like`).expect(404);
});

test('좋아요 10개 이상이면 인기글에 보이고, 볼 수 있는 글만 보인다', async () => {
  const schoolPost = await writePost(a, 'school', '학교 인기글');
  const allPost = await writePost(a, 'all', '전체 인기글');
  const voters = await Promise.all(Array.from({ length: 10 }, (_, i) => student(`voter${i}`)));
  for (const v of voters.slice(0, 9)) {
    await v.post(`/post/${schoolPost}/like`).expect(302);
    await v.post(`/post/${allPost}/like`).expect(302);
  }
  assert.doesNotMatch((await c.get('/hot')).text, /학교 인기글|전체 인기글/);
  await voters[9].post(`/post/${schoolPost}/like`).expect(302);
  await voters[9].post(`/post/${allPost}/like`).expect(302);

  const same = (await c.get('/hot')).text;     // 같은 학교
  assert.match(same, /학교 인기글/);
  assert.match(same, /전체 인기글/);
  const other = (await b.get('/hot')).text;    // 다른 학교
  assert.doesNotMatch(other, /학교 인기글/);
  assert.match(other, /전체 인기글/);
});
