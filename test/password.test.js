const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app, request, pool, reset, student, login } = require('./_helpers');

before(reset);
after(() => pool.end());

let a;
const tryLogin = (username, password) =>
  request(app).post('/login').type('form').send({ username, password });

test('현재 비밀번호가 틀리면 바꿀 수 없다', async () => {
  a = await student('alice');
  const res = await a.post('/me/password').type('form').send({ current: 'wrongpass', next: 'newpassword1' }).expect(400);
  assert.match(res.text, /현재 비밀번호가 맞지 않아요/);
  await tryLogin('alice', 'password1').expect(302);
});

test('새 비밀번호가 8자 미만이면 바꿀 수 없다', async () => {
  const res = await a.post('/me/password').type('form').send({ current: 'password1', next: 'short' }).expect(400);
  assert.match(res.text, /8자 이상/);
});

test('비밀번호를 바꾸면 새 비밀번호로만 로그인된다', async () => {
  const res = await a.post('/me/password').type('form').send({ current: 'password1', next: 'newpassword1' }).expect(200);
  assert.match(res.text, /비밀번호를 바꿨어요/);
  await tryLogin('alice', 'password1').expect(400);
  await login('alice', 'newpassword1');
});
