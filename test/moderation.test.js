const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, request, pool, query, reset, student, login, writePost } = require('./_helpers');

before(reset);
after(() => pool.end());

let admin, a, c, postId;

test('신고 화면에서 작성자를 정지하면 글과 댓글을 쓸 수 없다', async () => {
  admin = await login('admin', 'adminpass1');
  a = await student('alice'); c = await student('carol');
  postId = await writePost(a, 'all', '문제 글');
  await c.post(`/report/post/${postId}`).type('form').send({ reason: '욕설' }).expect(302);

  const page = (await admin.get('/admin')).text;
  assert.match(page, new RegExp(`/admin/suspend/post/${postId}`));
  assert.doesNotMatch(page.split('정지된 사용자')[0], /alice/); // 신고 목록에는 작성자가 안 보임
  await admin.post(`/admin/suspend/post/${postId}`).expect(302);

  await a.post('/board/all/new').type('form').send({ title: 't', body: 'b' }).expect(403);
  await a.post(`/post/${postId}/comment`).type('form').send({ body: '댓글' }).expect(403);
  assert.match((await a.get('/board/all')).text, /정지된 계정이에요/);
  await a.get(`/post/${postId}`).expect(200); // 읽기는 가능
});

test('관리자가 정지를 풀면 다시 쓸 수 있다', async () => {
  assert.match((await admin.get('/admin')).text, /정지된 사용자 \(1\)[\s\S]*alice/);
  const [{ id }] = await query(`SELECT id FROM users WHERE username = 'alice'`);
  await admin.post(`/admin/unsuspend/${id}`).expect(302);
  await writePost(a, 'all', '다시 쓴 글');
});

test('관리자가 아니면 정지할 수 없다', async () => {
  await c.post(`/admin/suspend/post/${postId}`).expect(403);
});

test('금지어가 들어간 글과 댓글은 올라가지 않는다', async () => {
  await admin.post('/admin/banned-words').type('form').send({ word: '바보' }).expect(302);
  const res = await a.post('/board/all/new').type('form').send({ title: '안녕', body: '너 진짜 바보야' }).expect(400);
  assert.match(res.text, /금지어\(&#34;바보&#34;\)/);
  await a.post(`/post/${postId}/comment`).type('form').send({ body: '바보' }).expect(400);
  const [{ n }] = await query(`SELECT count(*)::int AS n FROM comments WHERE body = '바보'`);
  assert.strictEqual(n, 0);
});

test('금지어를 지우면 다시 쓸 수 있다', async () => {
  const [{ id }] = await query(`SELECT id FROM banned_words WHERE word = '바보'`);
  await admin.post(`/admin/banned-words/${id}/delete`).expect(302);
  await writePost(a, 'all', '바보');
});

test('로그인을 10번 넘게 틀리면 잠시 막힌다', async () => {
  for (let i = 0; i < 10; i++)
    await request(app).post('/login').type('form').send({ username: 'alice', password: 'wrong' }).expect(400);
  const res = await request(app).post('/login').type('form').send({ username: 'alice', password: 'password1' });
  assert.strictEqual(res.status, 429);
  assert.match(res.text, /로그인 시도가 너무 많아요/);
});
