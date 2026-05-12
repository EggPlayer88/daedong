# 🛠️ 작업 환경 셋업 (Ubuntu/WSL)

기존 `kbo-sim-dev` 프로젝트와 충돌 없이 `daedong` 프로젝트를 클로드 코드로 작업하기 위한 환경 셋업 가이드.

---

## 1. 디렉토리 분리

WSL Ubuntu 안에서 프로젝트별로 디렉토리를 따로 둡니다. 다음과 같은 구조를 권장:

```
~/projects/
├── kbo-sim-dev/      ← 기존, 야구 시뮬 (건드리지 않음)
└── daedong/          ← 신규, 이 프로젝트
```

홈 디렉토리 `~` 는 WSL Ubuntu 의 `/home/<사용자명>/` 입니다.

---

## 2. daedong 디렉토리 만들기

WSL Ubuntu 터미널에서:

```bash
cd ~
mkdir -p projects/daedong
cd projects/daedong
```

---

## 3. GitHub 에서 clone

기존 GitHub repo (`EggPlayer88/daedong`) 를 그대로 clone 합니다:

```bash
git clone https://github.com/EggPlayer88/daedong.git .
```

마지막 `.` 은 "현재 디렉토리에 풀기" 라는 뜻입니다. 안 적으면 `daedong/daedong/` 처럼 중첩됩니다.

git 인증이 필요하면 GitHub 가 안내해주는 토큰 방식으로 진행하세요. (HTTPS + Personal Access Token 또는 SSH 키)

---

## 4. 현재 GitHub repo 상태 확인

clone 후 작업 환경 확인:

```bash
cd ~/projects/daedong
git status                    # 깨끗한 상태여야 함
git log --oneline | head -5   # 최근 커밋 5개 확인
ls -la                        # 파일 구조 확인
```

---

## 5. Node.js / npm 확인

이 프로젝트는 Vite + React 기반이라 Node.js 가 필요합니다. 버전 확인:

```bash
node --version    # v18 이상 권장
npm --version
```

설치 안 되어 있으면 WSL 에서:
```bash
sudo apt update
sudo apt install -y nodejs npm
```

또는 더 최신 버전을 원하면 nvm (Node Version Manager):
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
# 터미널 재시작 후
nvm install 20
nvm use 20
```

---

## 6. 의존성 설치

```bash
cd ~/projects/daedong
npm install
```

처음에 시간이 좀 걸립니다. 완료되면 `node_modules/` 가 생성됩니다.

---

## 7. 로컬 개발 서버 띄워보기 (선택)

설치가 잘 됐는지 확인하려면:

```bash
npm run dev
```

`.env.local` 파일이 없어서 Supabase 연결이 안 될 수 있는데, 그건 정상입니다. 코드만 빌드되어 돌아가는지 확인용이에요.

`.env.local` 파일이 필요하면 Vercel 대시보드의 환경변수 페이지에서 같은 값들을 복사해서 만드세요:

```env
# .env.local (gitignore 되어 있음)
VITE_SUPABASE_URL=https://dhaoszbqtbofqftgjfyb.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_GOOGLE_CLIENT_ID=...
ANTHROPIC_API_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

이 파일은 절대 GitHub 에 push 하면 안 됩니다 (`.gitignore` 에 포함되어 있을 거예요).

---

## 8. 클로드 코드 실행

`~/projects/daedong/` 디렉토리에서:

```bash
claude
```

또는 VS Code 안에서 작업한다면 VS Code 통합 (Claude Code for VS Code 확장) 을 통해 진입.

**중요**: kbo-sim-dev 디렉토리에서 실행한 Claude Code 와 별개의 세션이 됩니다. 두 프로젝트는 서로의 컨텍스트를 모릅니다.

---

## 9. 문서 먼저 읽도록 안내

클로드 코드가 시작되면 다음과 같이 시작하세요:

```
이 프로젝트는 대동여중 업무혁신시스템입니다.
`docs/CLAUDE.md` 를 먼저 읽고 프로젝트 컨텍스트를 파악해주세요.
그다음 README.md, docs/ARCHITECTURE.md, docs/DECISIONS.md, docs/ROADMAP.md 를 순서대로 읽고
현재 어디까지 진행됐는지 요약해주세요.
```

이렇게 하면 클로드 코드가 5개 문서를 읽고 프로젝트 전체를 파악합니다.

---

## 10. 일반적인 작업 흐름

```bash
# 1. 작업 시작 전 최신 코드 가져오기
cd ~/projects/daedong
git pull

# 2. 클로드 코드 실행
claude

# 3. 작업 진행 ...

# 4. 작업 완료 후 commit & push
git add .
git commit -m "Phase 4C-1: 드래프트 편집 페이지 추가"
git push
```

Vercel 이 자동으로 빌드해서 배포해줍니다.

---

## 11. 두 프로젝트 동시 작업 시 주의

kbo-sim-dev 와 daedong 을 동시에 작업할 때:

- **터미널을 분리**: 각 프로젝트마다 별도 터미널 창
- **클로드 코드 세션도 분리**: 디렉토리별로 별도 세션
- **`.env.local` 파일 다름**: 둘 다 비밀 키가 있는데 절대 섞이면 안 됨
- **Git 도 디렉토리별로 분리**: 한 디렉토리에서 다른 프로젝트 코드를 commit 하지 않도록 주의

---

## 12. 문제 발생 시

- **`git clone` 권한 거부**: GitHub Personal Access Token 필요. https://github.com/settings/tokens
- **`npm install` 에러**: Node.js 버전 너무 낮을 수 있음. v18 이상 필요.
- **`claude` 명령어 없음**: 이전에 설정한 Claude Code 가 PATH 에 있는지 확인. `which claude` 로 위치 확인.
- **WSL 에서 한글 깨짐**: `locale` 명령어로 UTF-8 인지 확인. 아니면 `sudo locale-gen ko_KR.UTF-8`.

---

이 셋업이 완료되면 클로드 코드와 함께 작업 가능한 상태입니다.
