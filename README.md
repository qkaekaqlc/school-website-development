# 학생 익명 게시판

중·고등학생만 쓰는 익명 게시판입니다. Express + Postgres(Supabase) + EJS로 만들었습니다.

## 기능
- 가입할 때 나이스에서 중·고등학교를 검색하고 학생증 사진을 올림 → 관리자가 승인하면 사용 가능 (사진은 승인이나 거절 직후 삭제)
- 학교별 게시판과 전체 게시판, 익명 글과 댓글 (댓글 작성자는 글쓴이·익명1·익명2…로 표시)
- 글과 댓글 신고 → 관리자 화면(`/admin`)에서 삭제하거나 넘김
- 좋아요(한 사람당 1번, 내 글 제외)와 인기글(좋아요 10개 이상)
- 오늘의 급식과 시간표(나이스), 학년·반은 내 정보에서 입력
- 관리자 제재: 작성자 정지·해제, 금지어, 로그인 실패 15분에 10번 넘으면 차단
- 게시판 검색, 20개씩 페이지 나누기, 내 글 수정, 내가 쓴 글·댓글 모아 보기, 비밀번호 변경

## 환경변수
| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | Postgres 접속 주소 (Supabase → Project Settings → Database → Connection string) |
| `SESSION_SECRET` | 긴 임의 문자열 |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | 처음 시작할 때 만들 관리자 계정 |
| `NEIS_KEY` | 나이스 오픈API 키 (없으면 학교 검색·급식·시간표 결과가 적게 나옴) |
| `NODE_ENV` | 배포할 때 `production` |
| `DATABASE_SSL` | 로컬 DB에서만 `false` |

## 실행
    npm install
    npm start          # 테이블은 처음 시작할 때 자동으로 생성

## 테스트 (테스트 DB의 데이터를 모두 지움)
    DATABASE_URL=postgresql://... DATABASE_SSL=false npm test

## Render 배포
Build Command `npm install`, Start Command `npm start`, 위 환경변수 입력.
