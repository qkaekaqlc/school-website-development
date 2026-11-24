const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { query } = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('trust proxy', 1);
app.use(express.urlencoded({ extended: false }));
app.use(cookieSession({
  name: 'sess',
  secret: process.env.SESSION_SECRET || 'dev-secret',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp)$/.test(file.mimetype)),
}).single('idcard');

const SCHOOL_KINDS = ['중학교', '고등학교'];

// 경로 값 검사 (Express 5는 경로 안 정규식을 지원하지 않음)
const allow = values => (req, res, next, v) => values.includes(v) ? next() : res.status(404).send('없는 페이지예요.');
app.param('scope', allow(['school', 'all']));
app.param('type', allow(['post', 'comment']));
app.param('action', allow(['approve', 'reject']));

// ── 로그인 사용자 불러오기 ──
app.use(async (req, res, next) => {
  res.locals.me = null;
  if (req.session.uid) {
    const [me] = await query(
      `SELECT u.id, u.username, u.status, u.is_admin, u.suspended, u.school_id, u.grade, u.class_nm,
              s.name AS school_name, s.kind AS school_kind, s.neis_code, s.office_code
       FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE u.id = $1`, [req.session.uid]);
    if (me) res.locals.me = req.me = me;
    else req.session = null;
  }
  next();
});

const requireApproved = (req, res, next) => {
  if (!req.me) return res.redirect('/login');
  if (req.me.status !== 'approved') return res.redirect('/pending');
  next();
};
// 글·댓글 쓰기: 승인됐고 정지되지 않은 사용자만
const requireActive = [requireApproved, (req, res, next) =>
  req.me.suspended ? res.status(403).send('정지된 계정이라 글과 댓글을 쓸 수 없어요.') : next()];
const requireAdmin = (req, res, next) =>
  req.me?.is_admin ? next() : res.status(403).send('관리자만 볼 수 있어요.');

const HOT_LIKES = 10; // 인기글 기준 좋아요 수

const canSee = (me, post) => me.is_admin || post.school_id === null || post.school_id === me.school_id;

// 글에 금지어가 있으면 그 단어를 돌려준다
async function findBannedWord(...texts) {
  const [row] = await query(
    'SELECT word FROM banned_words WHERE position(lower(word) in lower($1)) > 0 LIMIT 1', [texts.join('\n')]);
  return row?.word;
}

const back = (req, fallback) => {
  const ref = req.get('Referer');
  return ref && ref.startsWith(`${req.protocol}://${req.get('host')}/`) ? ref : fallback;
};

// ── 가입 / 로그인 ──
app.get('/', (req, res) => res.redirect(req.me ? '/board/school' : '/login'));

app.get('/signup', (req, res) => res.render('signup', { error: null }));

app.post('/signup', (req, res, next) => upload(req, res, async err => {
  const fail = msg => res.status(400).render('signup', { error: msg });
  try {
    if (err) return fail(err.code === 'LIMIT_FILE_SIZE' ? '사진은 5MB 이하만 올릴 수 있어요.' : '사진 업로드에 실패했어요.');
    const { username = '', password = '', neis_code, school_name, school_kind, school_address, school_office, agree } = req.body;
    if (!/^[a-zA-Z0-9_]{4,20}$/.test(username)) return fail('아이디는 영문, 숫자, _ 4~20자로 정해 주세요.');
    if (password.length < 8) return fail('비밀번호는 8자 이상이어야 해요.');
    if (!neis_code || !school_name || !SCHOOL_KINDS.includes(school_kind)) return fail('학교를 검색해서 선택해 주세요.');
    if (!req.file) return fail('학생증 사진(jpg, png, webp)을 올려 주세요.');
    if (!agree) return fail('개인정보 수집에 동의해 주세요.');

    const [taken] = await query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (taken) return fail('이미 쓰는 아이디예요.');

    const [school] = await query(
      `INSERT INTO schools (neis_code, name, kind, address, office_code) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (neis_code) DO UPDATE SET name = EXCLUDED.name,
         office_code = COALESCE(EXCLUDED.office_code, schools.office_code) RETURNING id`,
      [neis_code, school_name, school_kind, school_address || null, school_office || null]);
    const [user] = await query(
      `INSERT INTO users (username, password_hash, school_id, id_photo, id_photo_type)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, await bcrypt.hash(password, 10), school.id, req.file.buffer, req.file.mimetype]);
    req.session.uid = user.id;
    res.redirect('/pending');
  } catch (e) { next(e); }
}));

app.get('/login', (req, res) => res.render('login', { error: null }));

// 로그인 실패가 15분에 10번을 넘으면 잠시 막는다 (IP 기준)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true,
  handler: (req, res) => res.status(429).render('login', { error: '로그인 시도가 너무 많아요. 15분 뒤에 다시 시도해 주세요.' }),
});

app.post('/login', loginLimiter, async (req, res) => {
  const [user] = await query('SELECT id, password_hash FROM users WHERE username = $1', [req.body.username || '']);
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password_hash)))
    return res.status(400).render('login', { error: '아이디 또는 비밀번호가 맞지 않아요.' });
  req.session.uid = user.id;
  res.redirect('/');
});

app.post('/logout', (req, res) => { req.session = null; res.redirect('/login'); });

app.get('/pending', (req, res) => {
  if (!req.me) return res.redirect('/login');
  if (req.me.status === 'approved') return res.redirect('/');
  res.render('pending');
});

// 나이스 오픈API 호출. 결과가 없으면 빈 배열
async function neis(service, params) {
  const qs = new URLSearchParams({ Type: 'json', pSize: '100', ...params });
  if (process.env.NEIS_KEY) qs.set('KEY', process.env.NEIS_KEY);
  const r = await fetch(`https://open.neis.go.kr/hub/${service}?${qs}`);
  return (await r.json())?.[service]?.[1]?.row || [];
}

// 나이스 학교 검색 (중·고등학교만)
app.get('/schools/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  try {
    const rows = await neis('schoolInfo', { SCHUL_NM: q });
    res.json(rows.filter(s => SCHOOL_KINDS.includes(s.SCHUL_KND_SC_NM)).map(s => ({
      code: s.SD_SCHUL_CODE, name: s.SCHUL_NM, kind: s.SCHUL_KND_SC_NM, address: s.ORG_RDNMA,
      office: s.ATPT_OFCDC_SC_CODE,
    })));
  } catch {
    res.status(502).json({ error: '학교 검색에 실패했어요.' });
  }
});

// ── 내 정보 ──
app.get('/me', requireApproved, (req, res) => res.render('me', { message: null }));

app.post('/me/class', requireApproved, async (req, res) => {
  const grade = Number(req.body.grade), classNm = String(req.body.class_nm || '').trim();
  if (![1, 2, 3].includes(grade) || !/^[0-9A-Za-z가-힣]{1,5}$/.test(classNm))
    return res.status(400).render('me', { message: '학년(1~3)과 반을 정확히 입력해 주세요.' });
  await query('UPDATE users SET grade = $1, class_nm = $2 WHERE id = $3', [grade, classNm, req.me.id]);
  res.redirect('/today');
});

// ── 오늘의 급식과 시간표 ──
app.get('/today', requireApproved, async (req, res) => {
  const me = req.me;
  if (!me.school_id) return res.redirect('/board/all'); // 관리자는 학교가 없음
  const ymd = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replaceAll('-', '');
  const view = { date: `${ymd.slice(4, 6)}월 ${ymd.slice(6)}일`, meals: null, timetable: null, error: null };
  if (!me.office_code) {
    view.error = '학교 정보에 교육청 코드가 없어서 불러올 수 없어요. 관리자에게 알려 주세요.';
    return res.render('today', view);
  }
  const school = { ATPT_OFCDC_SC_CODE: me.office_code, SD_SCHUL_CODE: me.neis_code };
  try {
    const meals = await neis('mealServiceDietInfo', { ...school, MLSV_YMD: ymd });
    // "쌀밥 (5.6.)<br/>김치 (9.13.)" → ["쌀밥", "김치"] (알레르기 번호 제거)
    view.meals = meals.map(m => ({
      type: m.MMEAL_SC_NM,
      dishes: m.DDISH_NM.split(/<br\s*\/?>/i).map(d => d.replace(/\s*\([\d.\s]*\)/g, '').trim()).filter(Boolean),
    }));
    if (me.grade && me.class_nm) {
      const rows = await neis(me.school_kind === '고등학교' ? 'hisTimetable' : 'misTimetable',
        { ...school, ALL_TI_YMD: ymd, GRADE: me.grade, CLASS_NM: me.class_nm });
      view.timetable = rows.sort((a, b) => a.PERIO - b.PERIO).map(r => ({ period: r.PERIO, subject: r.ITRT_CNTNT }));
    }
  } catch (e) {
    console.error(e);
    view.error = '나이스에서 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
  res.render('today', view);
});

// ── 게시판 ──
app.get('/board/:scope', requireApproved, async (req, res) => {
  const school = req.params.scope === 'school';
  if (school && !req.me.school_id) return res.redirect('/board/all'); // 관리자는 학교가 없음
  const posts = await query(
    `SELECT p.id, p.title, p.created_at,
            (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND NOT c.deleted)::int AS comment_count,
            (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id)::int AS like_count
     FROM posts p WHERE NOT p.deleted AND ${school ? 'p.school_id = $1' : 'p.school_id IS NULL'}
     ORDER BY p.id DESC LIMIT 100`, school ? [req.me.school_id] : []);
  res.render('board', { scope: req.params.scope, posts });
});

// 인기글: 내가 볼 수 있는 글 중 좋아요가 HOT_LIKES개 이상
app.get('/hot', requireApproved, async (req, res) => {
  const posts = await query(
    `SELECT * FROM (
       SELECT p.id, p.title, p.created_at,
              (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND NOT c.deleted)::int AS comment_count,
              (SELECT count(*) FROM post_likes l WHERE l.post_id = p.id)::int AS like_count
       FROM posts p WHERE NOT p.deleted AND ($1 OR p.school_id IS NULL OR p.school_id = $2)) t
     WHERE like_count >= $3 ORDER BY id DESC LIMIT 100`, [req.me.is_admin, req.me.school_id, HOT_LIKES]);
  res.render('board', { scope: 'hot', posts });
});

app.get('/board/:scope/new', requireApproved, (req, res) =>
  res.render('new', { scope: req.params.scope, error: null }));

app.post('/board/:scope/new', requireActive, async (req, res) => {
  const { scope } = req.params;
  const title = (req.body.title || '').trim(), body = (req.body.body || '').trim();
  if (!title || !body || title.length > 100 || body.length > 5000)
    return res.status(400).render('new', { scope, error: '제목(100자 이하)과 내용(5000자 이하)을 입력해 주세요.' });
  const banned = await findBannedWord(title, body);
  if (banned) return res.status(400).render('new', { scope, error: `금지어("${banned}")가 들어 있어요.` });
  const schoolId = scope === 'school' ? req.me.school_id : null;
  if (scope === 'school' && !schoolId) return res.status(400).send('학교 게시판에 쓸 수 없어요.');
  const [post] = await query(
    'INSERT INTO posts (user_id, school_id, title, body) VALUES ($1, $2, $3, $4) RETURNING id',
    [req.me.id, schoolId, title, body]);
  res.redirect(`/post/${post.id}`);
});

async function findPost(req, res) {
  const [post] = await query('SELECT * FROM posts WHERE id = $1 AND NOT deleted', [Number(req.params.id) || 0]);
  if (!post || !canSee(req.me, post)) { res.status(404).send('글을 찾을 수 없어요.'); return null; }
  return post;
}

app.get('/post/:id', requireApproved, async (req, res) => {
  const post = await findPost(req, res);
  if (!post) return;
  const rows = await query(
    `SELECT c.*, (SELECT count(*) FROM comment_likes l WHERE l.comment_id = c.id)::int AS like_count,
            EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = $2) AS liked
     FROM comments c WHERE c.post_id = $1 ORDER BY c.id`, [post.id, req.me.id]);
  const [likes] = await query(
    `SELECT count(*)::int AS count, bool_or(user_id = $2) AS liked FROM post_likes WHERE post_id = $1`, [post.id, req.me.id]);
  // 댓글 작성자를 글쓴이 / 익명1, 익명2 ... 로 표시 (user_id는 화면에 넘기지 않음)
  const labels = new Map([[post.user_id, '글쓴이']]);
  const comments = rows.map(c => {
    if (!labels.has(c.user_id)) labels.set(c.user_id, `익명${labels.size}`);
    return { id: c.id, body: c.deleted ? null : c.body, created_at: c.created_at,
             label: labels.get(c.user_id), mine: c.user_id === req.me.id, likes: c.like_count, liked: c.liked };
  });
  res.render('post', {
    post: { id: post.id, title: post.title, body: post.body, created_at: post.created_at,
            mine: post.user_id === req.me.id, scope: post.school_id ? 'school' : 'all',
            likes: likes.count, liked: !!likes.liked },
    comments,
  });
});

app.post('/post/:id/comment', requireActive, async (req, res) => {
  const post = await findPost(req, res);
  if (!post) return;
  const body = (req.body.body || '').trim();
  const banned = await findBannedWord(body);
  if (banned) return res.status(400).send(`금지어("${banned}")가 들어 있어서 댓글을 올릴 수 없어요.`);
  if (body && body.length <= 1000)
    await query('INSERT INTO comments (post_id, user_id, body) VALUES ($1, $2, $3)', [post.id, req.me.id, body]);
  res.redirect(`/post/${post.id}`);
});

app.post('/post/:id/delete', requireApproved, async (req, res) => {
  const post = await findPost(req, res);
  if (!post) return;
  if (post.user_id !== req.me.id && !req.me.is_admin) return res.status(403).send('삭제할 수 없어요.');
  await query('UPDATE posts SET deleted = true WHERE id = $1', [post.id]);
  await query(`UPDATE reports SET resolved = true WHERE target_type = 'post' AND target_id = $1`, [post.id]);
  res.redirect(req.me.is_admin && post.user_id !== req.me.id ? '/admin' : `/board/${post.school_id ? 'school' : 'all'}`);
});

app.post('/comment/:id/delete', requireApproved, async (req, res) => {
  const [c] = await query('SELECT * FROM comments WHERE id = $1 AND NOT deleted', [Number(req.params.id) || 0]);
  if (!c || (c.user_id !== req.me.id && !req.me.is_admin)) return res.status(403).send('삭제할 수 없어요.');
  await query('UPDATE comments SET deleted = true WHERE id = $1', [c.id]);
  await query(`UPDATE reports SET resolved = true WHERE target_type = 'comment' AND target_id = $1`, [c.id]);
  res.redirect(back(req, `/post/${c.post_id}`));
});

// ── 좋아요 (다시 누르면 취소, 내 글에는 못 누름) ──
async function toggleLike(table, column, targetId, userId) {
  const removed = await query(`DELETE FROM ${table} WHERE ${column} = $1 AND user_id = $2 RETURNING 1`, [targetId, userId]);
  if (!removed.length) await query(`INSERT INTO ${table} (${column}, user_id) VALUES ($1, $2)`, [targetId, userId]);
}

app.post('/post/:id/like', requireApproved, async (req, res) => {
  const post = await findPost(req, res);
  if (!post) return;
  if (post.user_id === req.me.id) return res.status(400).send('내 글에는 좋아요를 누를 수 없어요.');
  await toggleLike('post_likes', 'post_id', post.id, req.me.id);
  res.redirect(`/post/${post.id}`);
});

app.post('/comment/:id/like', requireApproved, async (req, res) => {
  const [c] = await query(
    `SELECT c.id, c.user_id, c.post_id, p.school_id FROM comments c JOIN posts p ON p.id = c.post_id
     WHERE c.id = $1 AND NOT c.deleted AND NOT p.deleted`, [Number(req.params.id) || 0]);
  if (!c || !canSee(req.me, c)) return res.status(404).send('댓글을 찾을 수 없어요.');
  if (c.user_id === req.me.id) return res.status(400).send('내 댓글에는 좋아요를 누를 수 없어요.');
  await toggleLike('comment_likes', 'comment_id', c.id, req.me.id);
  res.redirect(`/post/${c.post_id}`);
});

// ── 신고 ──
app.post('/report/:type/:id', requireApproved, async (req, res) => {
  const { type } = req.params, id = Number(req.params.id) || 0;
  const [target] = type === 'post'
    ? await query('SELECT id, school_id FROM posts WHERE id = $1 AND NOT deleted', [id])
    : await query(`SELECT c.id, p.school_id FROM comments c JOIN posts p ON p.id = c.post_id
                   WHERE c.id = $1 AND NOT c.deleted`, [id]);
  if (!target || !canSee(req.me, target)) return res.status(404).send('대상을 찾을 수 없어요.');
  const reason = (req.body.reason || '기타').slice(0, 200);
  await query(`INSERT INTO reports (target_type, target_id, reporter_id, reason) VALUES ($1, $2, $3, $4)
               ON CONFLICT DO NOTHING`, [type, id, req.me.id, reason]);
  res.redirect(back(req, '/'));
});

// ── 관리자 ──
app.get('/admin', requireAdmin, async (req, res) => {
  const pending = await query(
    `SELECT u.id, u.username, u.created_at, s.name AS school_name, s.kind, s.address
     FROM users u JOIN schools s ON s.id = u.school_id WHERE u.status = 'pending' ORDER BY u.id`);
  const reports = await query(
    `SELECT r.target_type, r.target_id, count(*)::int AS count, string_agg(DISTINCT r.reason, ', ') AS reasons,
            COALESCE(p.title || ' / ' || p.body, c.body) AS content, COALESCE(p.id, c.post_id) AS post_id
     FROM reports r
     LEFT JOIN posts p ON r.target_type = 'post' AND p.id = r.target_id
     LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
     WHERE NOT r.resolved GROUP BY r.target_type, r.target_id, p.id, c.id ORDER BY count DESC`);
  const suspended = await query(
    `SELECT u.id, u.username, s.name AS school_name FROM users u LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.suspended ORDER BY u.id`);
  const bannedWords = await query('SELECT id, word FROM banned_words ORDER BY word');
  res.render('admin', { pending, reports, suspended, bannedWords });
});

app.get('/admin/photo/:id', requireAdmin, async (req, res) => {
  const [u] = await query('SELECT id_photo, id_photo_type FROM users WHERE id = $1', [Number(req.params.id) || 0]);
  if (!u?.id_photo) return res.status(404).send('사진이 없어요.');
  res.set({ 'Content-Type': u.id_photo_type, 'Cache-Control': 'no-store' }).send(u.id_photo);
});

app.post('/admin/users/:id/:action', requireAdmin, async (req, res) => {
  // 승인이든 거절이든 학생증 사진은 바로 지운다
  await query(`UPDATE users SET status = $1, id_photo = NULL, id_photo_type = NULL WHERE id = $2 AND status = 'pending'`,
    [req.params.action === 'approve' ? 'approved' : 'rejected', Number(req.params.id) || 0]);
  res.redirect('/admin');
});

app.post('/admin/reports/:type/:id/dismiss', requireAdmin, async (req, res) => {
  await query('UPDATE reports SET resolved = true WHERE target_type = $1 AND target_id = $2',
    [req.params.type, Number(req.params.id) || 0]);
  res.redirect('/admin');
});

// 신고된 글·댓글의 작성자 정지 (작성자가 누구인지는 화면에 보이지 않음)
app.post('/admin/suspend/:type/:id', requireAdmin, async (req, res) => {
  const table = req.params.type === 'post' ? 'posts' : 'comments';
  await query(`UPDATE users SET suspended = true WHERE NOT is_admin AND id = (SELECT user_id FROM ${table} WHERE id = $1)`,
    [Number(req.params.id) || 0]);
  res.redirect('/admin');
});

app.post('/admin/unsuspend/:id', requireAdmin, async (req, res) => {
  await query('UPDATE users SET suspended = false WHERE id = $1', [Number(req.params.id) || 0]);
  res.redirect('/admin');
});

app.post('/admin/banned-words', requireAdmin, async (req, res) => {
  const word = String(req.body.word || '').trim();
  if (word && word.length <= 30) await query('INSERT INTO banned_words (word) VALUES ($1) ON CONFLICT DO NOTHING', [word]);
  res.redirect('/admin');
});

app.post('/admin/banned-words/:id/delete', requireAdmin, async (req, res) => {
  await query('DELETE FROM banned_words WHERE id = $1', [Number(req.params.id) || 0]);
  res.redirect('/admin');
});

app.use((err, req, res, next) => { console.error(err); res.status(500).send('서버 오류가 발생했어요.'); });

module.exports = app;
