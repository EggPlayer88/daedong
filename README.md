# 대동여중 업무 시스템

AI 기반 학교 업무 지식관리 시스템 프로토타입

## 배포 방법 (Vercel)

### 방법 1: GitHub 연결 (추천)
1. 이 폴더를 GitHub 저장소에 올리기
2. [vercel.com](https://vercel.com) 접속 → GitHub 로그인
3. "New Project" → 해당 저장소 선택
4. Framework: Vite 자동 감지됨
5. "Deploy" 클릭 → 완료

### 방법 2: Vercel CLI
```bash
npm install -g vercel
cd daedong-school
npm install
vercel
```

## 로컬 실행
```bash
npm install
npm run dev
```

## 기술 스택
- React 18
- Vite 6
- Vercel (배포)
- 추후: Supabase + Claude API 연동 예정
