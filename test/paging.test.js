const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { pool, query, reset, student, userId } = require('./_helpers');

before(reset);
after(() => pool.end());

let a;
const titles = html => [...html.matchAll(/>(글 \d+)<\/a>/g)].map(m => m[1]);

test('목록은 20개씩 나뉘고 이전/다음으로 넘긴다', async () => {
  a = await student('alice');
  const uid = await userId('alice');
  for (let i = 1; i <= 45; i++)
    await query(`INSERT INTO posts (user_id, school_id, title, body) VALUES ($1, NULL, $2, $3)`,
      [uid, `글 ${i}`, i % 2 ? '홀수' : '짝수']);

  const p1 = (await a.get('/board/all')).text;
  assert.strictEqual(titles(p1).length, 20);
  assert.strictEqual(titles(p1)[0], '글 45');
  assert.match(p1, /href="\/board\/all\?page=2">다음/);
  assert.doesNotMatch(p1, /이전/);

  const p3 = (await a.get('/board/all?page=3')).text;
  assert.deepStrictEqual(titles(p3), ['글 5', '글 4', '글 3', '글 2', '글 1']);
  assert.match(p3, /href="\/board\/all\?page=2">← 이전/);
  assert.doesNotMatch(p3, /다음/);
});

test('검색어는 다음 페이지에도 유지된다', async () => {
  const html = (await a.get('/board/all?q=' + encodeURIComponent('홀수'))).text;
  assert.strictEqual(titles(html).length, 20);
  assert.match(html, /href="\/board\/all\?q=%ED%99%80%EC%88%98&amp;page=2">다음/);
  const p2 = (await a.get('/board/all?q=' + encodeURIComponent('홀수') + '&page=2')).text;
  assert.deepStrictEqual(titles(p2), ['글 5', '글 3', '글 1']);
});

test('이상한 page 값은 1쪽으로 본다', async () => {
  for (const p of ['0', '-3', 'abc'])
    assert.strictEqual(titles((await a.get(`/board/all?page=${p}`)).text)[0], '글 45');
});
