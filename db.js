const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

const query = (text, params) => pool.query(text, params).then(r => r.rows);

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schools (
      id SERIAL PRIMARY KEY,
      neis_code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,                  -- 중학교 | 고등학교
      address TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      school_id INT REFERENCES schools(id),
      status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
      is_admin BOOLEAN NOT NULL DEFAULT false,
      id_photo BYTEA,                      -- 학생증 사진. 승인/거절하면 지운다
      id_photo_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id),
      school_id INT REFERENCES schools(id), -- NULL이면 전체 게시판
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      post_id INT NOT NULL REFERENCES posts(id),
      user_id INT NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      target_type TEXT NOT NULL,           -- post | comment
      target_id INT NOT NULL,
      reporter_id INT NOT NULL REFERENCES users(id),
      reason TEXT NOT NULL,
      resolved BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (target_type, target_id, reporter_id)
    );
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id INT NOT NULL REFERENCES posts(id),
      user_id INT NOT NULL REFERENCES users(id),
      PRIMARY KEY (post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS comment_likes (
      comment_id INT NOT NULL REFERENCES comments(id),
      user_id INT NOT NULL REFERENCES users(id),
      PRIMARY KEY (comment_id, user_id)
    );
  `);

  // 관리자 계정은 환경변수로 처음 한 번 만든다
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (ADMIN_USERNAME && ADMIN_PASSWORD) {
    await pool.query(
      `INSERT INTO users (username, password_hash, status, is_admin)
       VALUES ($1, $2, 'approved', true) ON CONFLICT (username) DO NOTHING`,
      [ADMIN_USERNAME, await bcrypt.hash(ADMIN_PASSWORD, 10)]
    );
  }
}

module.exports = { pool, query, init };
