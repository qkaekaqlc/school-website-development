const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { pool, query, reset, student, login, writePost } = require('./_helpers');

before(reset);
after(() => pool.end());

let a, c, id;

test('새 글 쓰기 화면은 비어 있다', async () => {
  a = await student('alice'); c = await student('carol');
  const html = (await a.get('/board/all/new')).text;
  assert.match(html, /name="title" maxlength="100" value=""/);
  assert.doesNotMatch(html, /undefined/);
});

test('내 글을 수정하면 내용이 바뀌고 수정됨이 표시된다', async () => {
  id = await writePost(a, 'all', '처음 제목', '처음 내용');
  const form = (await a.get(`/post/${id}/edit`).expect(200)).text;
  assert.match(form, /value="처음 제목"/);
  assert.match(form, />처음 내용<\/textarea>/);
  await a.post(`/post/${id}/edit`).type('form').send({ title: '바뀐 제목', body: '바뀐 내용' })
    .expect(302).expect('Location', `/post/${id}`);
  const html = (await c.get(`/post/${id}`)).text;
  assert.match(html, /바뀐 제목/);
  assert.match(html, /· 수정됨/);
  assert.doesNotMatch(html, /\/edit"/); // 남에게는 수정 버튼이 없음
});

test('남의 글은 관리자라도 수정할 수 없다', async () => {
  await c.get(`/post/${id}/edit`).expect(403);
  await c.post(`/post/${id}/edit`).type('form').send({ title: 'x', body: 'y' }).expect(403);
  const admin = await login('admin', 'adminpass1');
  await admin.post(`/post/${id}/edit`).type('form').send({ title: 'x', body: 'y' }).expect(403);
  const [post] = await query('SELECT title FROM posts WHERE id = $1', [id]);
  assert.strictEqual(post.title, '바뀐 제목');
});

test('수정할 때도 금지어와 빈 내용을 막는다', async () => {
  await query(`INSERT INTO banned_words (word) VALUES ('바보')`);
  const res = await a.post(`/post/${id}/edit`).type('form').send({ title: '바보', body: '내용' }).expect(400);
  assert.match(res.text, /value="바보"/); // 입력한 내용은 남아 있음
  await a.post(`/post/${id}/edit`).type('form').send({ title: '', body: '내용' }).expect(400);
});

test('정지되면 수정할 수 없다', async () => {
  await query(`UPDATE users SET suspended = true WHERE username = 'alice'`);
  await a.post(`/post/${id}/edit`).type('form').send({ title: '정지 중', body: '내용' }).expect(403);
});
