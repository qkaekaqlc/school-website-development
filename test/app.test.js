// 실행: DATABASE_URL=... DATABASE_SSL=false npm test  (테스트 DB의 내용을 모두 지움)
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'adminpass1';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const { pool, query, init } = require('../db');
const app = require('../app');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const realFetch = global.fetch;

before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await init();
  // 나이스 API 가짜 응답 (초등학교가 섞여 있음)
  global.fetch = async () => ({
    json: async () => ({ schoolInfo: [{}, { row: [
      { SD_SCHUL_CODE: 'M1', SCHUL_NM: '가나중학교', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '서울' },
      { SD_SCHUL_CODE: 'H1', SCHUL_NM: '가나고등학교', SCHUL_KND_SC_NM: '고등학교', ORG_RDNMA: '서울' },
      { SD_SCHUL_CODE: 'E1', SCHUL_NM: '가나초등학교', SCHUL_KND_SC_NM: '초등학교', ORG_RDNMA: '서울' },
    ] }] }),
  });
});
after(async () => { global.fetch = realFetch; await pool.end(); });

async function signup(username, code, name, kind) {
  const agent = request.agent(app);
  const res = await agent.post('/signup')
    .field({ username, password: 'password1', neis_code: code, school_name: name, school_kind: kind, agree: '1' })
    .attach('idcard', PNG, { filename: 'id.png', contentType: 'image/png' });
  assert.strictEqual(res.headers.location, '/pending', res.text);
  return agent;
}
const login = async (username, password) => {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username, password }).expect(302);
  return agent;
};
const userId = async name => (await query('SELECT id FROM users WHERE username = $1', [name]))[0].id;

let admin, a, b, c, postId;

test('학교 검색은 중·고등학교만 돌려준다', async () => {
  const res = await request(app).get('/schools/search?q=가나').expect(200);
  assert.deepStrictEqual(res.body.map(s => s.kind), ['중학교', '고등학교']);
});

test('학생증 없이는 가입할 수 없다', async () => {
  const res = await request(app).post('/signup')
    .field({ username: 'nophoto', password: 'password1', neis_code: 'M1', school_name: '가나중학교', school_kind: '중학교', agree: '1' });
  assert.strictEqual(res.status, 400);
  assert.match(res.text, /학생증 사진/);
});

test('초등학교로는 가입할 수 없다', async () => {
  const res = await request(app).post('/signup')
    .field({ username: 'elem', password: 'password1', neis_code: 'E1', school_name: '가나초등학교', school_kind: '초등학교', agree: '1' })
    .attach('idcard', PNG, { filename: 'id.png', contentType: 'image/png' });
  assert.strictEqual(res.status, 400);
});

test('승인 전에는 게시판에 들어갈 수 없다', async () => {
  a = await signup('alice', 'M1', '가나중학교', '중학교');
  b = await signup('bobby', 'H1', '가나고등학교', '고등학교');
  c = await signup('carol', 'M1', '가나중학교', '중학교');
  await a.get('/board/school').expect(302).expect('Location', '/pending');
  await a.post('/board/all/new').type('form').send({ title: 't', body: 'b' }).expect(302).expect('Location', '/pending');
});

test('관리자가 승인하면 학생증 사진이 지워지고 게시판을 쓸 수 있다', async () => {
  admin = await login('admin', 'adminpass1');
  const page = await admin.get('/admin').expect(200);
  assert.match(page.text, /alice/);
  await admin.get(`/admin/photo/${await userId('alice')}`).expect(200).expect('Content-Type', 'image/png');
  await a.get('/admin').expect(403);

  for (const name of ['alice', 'bobby', 'carol'])
    await admin.post(`/admin/users/${await userId(name)}/approve`).expect(302);
  const rows = await query('SELECT status, id_photo FROM users WHERE NOT is_admin');
  assert.ok(rows.every(r => r.status === 'approved' && r.id_photo === null));
  await a.get('/board/school').expect(200);
});

test('거절해도 학생증 사진이 지워진다', async () => {
  const d = await signup('dave', 'M1', '가나중학교', '중학교');
  await admin.post(`/admin/users/${await userId('dave')}/reject`).expect(302);
  const [row] = await query(`SELECT status, id_photo FROM users WHERE username = 'dave'`);
  assert.deepStrictEqual(row, { status: 'rejected', id_photo: null });
  await d.get('/board/all').expect(302).expect('Location', '/pending');
});

test('학교 게시판 글은 같은 학교만 볼 수 있다', async () => {
  const res = await a.post('/board/school/new').type('form').send({ title: '우리 학교 글', body: '내용' }).expect(302);
  postId = res.headers.location.split('/').pop();
  await c.get(`/post/${postId}`).expect(200);
  await b.get(`/post/${postId}`).expect(404);
  assert.doesNotMatch((await b.get('/board/school')).text, /우리 학교 글/);
  assert.match((await c.get('/board/school')).text, /우리 학교 글/);
});

test('전체 게시판 글은 모든 학교가 볼 수 있다', async () => {
  const res = await a.post('/board/all/new').type('form').send({ title: '전체 글', body: '내용' }).expect(302);
  const id = res.headers.location.split('/').pop();
  await b.get(`/post/${id}`).expect(200);
  assert.match((await b.get('/board/all')).text, /전체 글/);
});

test('댓글은 글쓴이/익명N으로 보이고 아이디는 드러나지 않는다', async () => {
  await c.post(`/post/${postId}/comment`).type('form').send({ body: '첫 댓글' }).expect(302);
  await a.post(`/post/${postId}/comment`).type('form').send({ body: '작성자 답글' }).expect(302);
  await c.post(`/post/${postId}/comment`).type('form').send({ body: '또 댓글' }).expect(302);
  const html = (await c.get(`/post/${postId}`)).text;
  assert.strictEqual(html.match(/<b>익명1<\/b>/g).length, 2);
  assert.match(html, /<b>글쓴이<\/b>/);
  assert.doesNotMatch(html, /alice|carol/);
});

test('신고하면 관리자가 보고 삭제할 수 있다', async () => {
  await c.post(`/report/post/${postId}`).type('form').send({ reason: '욕설' }).expect(302);
  await c.post(`/report/post/${postId}`).type('form').send({ reason: '욕설' }).expect(302); // 중복 신고 무시
  await b.post(`/report/post/${postId}`).type('form').send({ reason: '욕설' }).expect(404); // 다른 학교는 못 봄
  const page = (await admin.get('/admin')).text;
  assert.match(page, /신고 1건 · 욕설/);
  await admin.post(`/post/${postId}/delete`).expect(302).expect('Location', '/admin');
  await c.get(`/post/${postId}`).expect(404);
  assert.match((await admin.get('/admin')).text, /신고 \(0\)/);
});

test('남의 글은 지울 수 없다', async () => {
  const res = await a.post('/board/all/new').type('form').send({ title: '내 글', body: '내용' }).expect(302);
  const id = res.headers.location.split('/').pop();
  await b.post(`/post/${id}/delete`).expect(403);
});
