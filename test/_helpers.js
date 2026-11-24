// 테스트 공통 도구. 실행할 때마다 테스트 DB의 내용을 모두 지운다.
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'adminpass1';

const assert = require('node:assert');
const request = require('supertest');
const { pool, query, init } = require('../db');
const app = require('../app');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const SCHOOLS = {
  M1: { name: '가나중학교', kind: '중학교' },
  H1: { name: '가나고등학교', kind: '고등학교' },
};

// 나이스 API 가짜 응답. 테스트에서 neis[서비스 이름]을 바꿔 쓸 수 있다
const neis = {
  schoolInfo: [
    { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: 'M1', SCHUL_NM: '가나중학교', SCHUL_KND_SC_NM: '중학교', ORG_RDNMA: '서울' },
    { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: 'H1', SCHUL_NM: '가나고등학교', SCHUL_KND_SC_NM: '고등학교', ORG_RDNMA: '서울' },
    { ATPT_OFCDC_SC_CODE: 'B10', SD_SCHUL_CODE: 'E1', SCHUL_NM: '가나초등학교', SCHUL_KND_SC_NM: '초등학교', ORG_RDNMA: '서울' },
  ],
};
const neisCalls = [];
global.fetch = async url => {
  url = String(url);
  neisCalls.push(url);
  const service = new URL(url).pathname.split('/').pop();
  const rows = neis[service];
  return { json: async () => (rows ? { [service]: [{}, { row: rows }] } : { RESULT: { CODE: 'INFO-200' } }) };
};

async function reset() {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await init();
}

async function signup(username, code = 'M1') {
  const agent = request.agent(app);
  const s = SCHOOLS[code];
  const res = await agent.post('/signup')
    .field({ username, password: 'password1', neis_code: code, school_name: s.name, school_kind: s.kind,
             school_office: 'B10', agree: '1' })
    .attach('idcard', PNG, { filename: 'id.png', contentType: 'image/png' });
  assert.strictEqual(res.headers.location, '/pending', res.text);
  return agent;
}

async function login(username, password = 'password1') {
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username, password }).expect(302);
  return agent;
}

const userId = async name => (await query('SELECT id FROM users WHERE username = $1', [name]))[0].id;

// 가입하고 바로 승인된 사용자
async function student(username, code = 'M1') {
  const agent = await signup(username, code);
  await query(`UPDATE users SET status = 'approved', id_photo = NULL WHERE username = $1`, [username]);
  return agent;
}

async function writePost(agent, scope, title, body = '내용') {
  const res = await agent.post(`/board/${scope}/new`).type('form').send({ title, body }).expect(302);
  return res.headers.location.split('/').pop();
}

module.exports = { app, request, pool, query, PNG, neis, neisCalls, reset, signup, login, userId, student, writePost };
