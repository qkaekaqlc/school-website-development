# 학생 익명 게시판

중·고등학생만 쓰는 익명 게시판입니다. Express + Postgres(Supabase) + EJS로 만들었습니다.

## 기능
- 가입할 때 나이스에서 중·고등학교를 검색하고 학생증 사진을 올림 → 관리자가 승인하면 사용 가능 (사진은 승인이나 거절 직후 삭제)
- 학교별 게시판과 전체 게시판, 익명 글과 댓글 (댓글 작성자는 글쓴이·익명1·익명2…로 표시)
- 글과 댓글 신고 → 관리자 화면(`/admin`)에서 삭제하거나 넘김

## 환경변수
| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | Postgres 접속 주소 (Supabase → Project Settings → Database → Connection string) |
| `SESSION_SECRET` | 긴 임의 문자열 |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | 처음 시작할 때 만들 관리자 계정 |
| `NEIS_KEY` | 나이스 오픈API 키 (없으면 검색 결과가 적게 나옴) |
| `NODE_ENV` | 배포할 때 `production` |
| `DATABASE_SSL` | 로컬 DB에서만 `false` |

## 실행
    npm install
    npm start          # 테이블은 처음 시작할 때 자동으로 생성

## 테스트 (테스트 DB의 데이터를 모두 지움)
    DATABASE_URL=postgresql://... DATABASE_SSL=false npm test

## Render 배포
Build Command `npm install`, Start Command `npm start`, 위 환경변수 입력.
