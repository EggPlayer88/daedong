# 🎨 CONVENTIONS — 코드 컨벤션과 작업 스타일

이 문서는 코드 작성 방식, UI 패턴, 사용자와의 협업 방식을 정리합니다.

---

## 1. 일반 코드 스타일

### 언어
- **주석은 한국어** (의미 명확, 사용자가 직접 읽음)
- **변수명/함수명은 영어** (camelCase)
- **파일명은 PascalCase** (`TimetablesListPage.jsx`)
- **API 라우트 파일명은 kebab-case** (`recommend-substitute.js`)

### Import 규칙
- 클라이언트 코드 (`src/`): 확장자 생략 가능 (Vite 가 처리)
- API 라우트 (`api/`): **확장자 필수** (.js)
  ```javascript
  // ❌ Vercel ESM 에서 ERR_MODULE_NOT_FOUND
  import { foo } from './_helper';
  
  // ✅ OK
  import { foo } from './_helper.js';
  ```

### 함수 정의
- 컴포넌트는 `function` 선언 (호이스팅 활용)
- 헬퍼는 화살표 함수도 OK
- 1줄 짜리는 화살표 함수

### 상수 명명
- 정적 데이터: 대문자 짧게 (`SBJ`, `TCH`, `CLS`, `DAYS`)
- 색상 객체: `C` (Color)
- 폰트: `font`
- 라벨/유형 매핑: `TYPE_LABELS`, `STATUS_LABELS`

---

## 2. UI 컨벤션

### 색상 팔레트 (`C` 객체)

```javascript
const C = {
  bg:'#0c0f1a',          // 페이지 배경
  card:'#141929',        // 카드 배경
  cardHover:'#1a2038',   // 카드 호버
  border:'#232940',      // 일반 테두리
  borderLight:'#2d3555', // 강조 테두리

  accent:'#4f8cff',      // 메인 액센트 (파란색)
  accentSoft:'#4f8cff18',// 액센트 반투명 배경

  text:'#e8ecf4',        // 본문 텍스트
  textMid:'#8b95ad',     // 중간 텍스트 (보조 설명)
  textDim:'#5a6480',     // 흐린 텍스트 (라벨, 메타)

  green:'#34d399',       // 성공, 활성
  yellow:'#fbbf24',      // 경고, 대기
  red:'#f87171',         // 에러, 반려
  purple:'#a78bfa',      // 관리자 모드, 특별

  exam:'#7c2d12', examBg:'#7c2d1218',
  holiday:'#dc2626', holidayBg:'#dc262618',
  event:'#ca8a04', eventBg:'#ca8a0418',
};
```

### 폰트

```javascript
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";
```

모든 컴포넌트 최상위에 `fontFamily: font`.

### 버튼 패턴

함수형 스타일 생성기:

```javascript
function btnStyle({ active = false, primary = false, disabled = false, ai = false, small = false } = {}) {
  return {
    padding: small ? '4px 10px' : '7px 14px',
    fontSize: small ? 11 : 12, fontFamily: font,
    border: `1px solid ${primary ? C.accent : ...}`,
    background: primary ? C.accent : ...,
    color: primary ? '#fff' : ...,
    borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}
```

### 카드 패턴

```javascript
<div style={{
  background: C.card,
  border: `1px solid ${C.border}`,
  borderLeft: `4px solid ${색}`,  // 카테고리 표시
  borderRadius: 8,
  padding: '14px 16px',
  marginBottom: 8,
}}>
```

### 페이지 헤더 패턴

```javascript
<div style={{ marginBottom: 20 }}>
  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🗂️ 페이지 제목</h2>
  <div style={{ fontSize: 12, color: C.textMid, marginTop: 4 }}>
    페이지 설명 한 줄
  </div>
</div>
```

### 비어있는 상태

```javascript
<div style={{
  padding: '20px 16px', background: C.card, borderRadius: 8,
  color: C.textDim, fontSize: 12, lineHeight: 1.6,
  border: `1px dashed ${C.border}`
}}>
  비어있는 안내 메시지
</div>
```

### Section / 그룹

```javascript
<div style={{ marginBottom: 24 }}>
  <div style={{
    fontSize: 12, fontWeight: 600, color: C.textDim,
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4,
  }}>
    📌 섹션 제목
  </div>
  {/* 내용 */}
</div>
```

---

## 3. 데이터 흐름 패턴

### Supabase 호출 분리

UI 컴포넌트는 직접 Supabase 호출하지 않고 `src/lib/*API.js` 의 함수를 호출:

```javascript
// ❌ 안 좋음 — 컴포넌트가 Supabase 직접 호출
const { data } = await supabase.from('timetables').select('*');

// ✅ 좋음 — 라이브러리 함수 호출
import { listTimetables } from '../lib/timetablesAPI';
const data = await listTimetables();
```

### 로딩/에러 상태

표준 패턴:

```javascript
const [items, setItems] = useState([]);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

const refresh = async () => {
  setError(null);
  try {
    const data = await fetchItems();
    setItems(data);
  } catch (e) {
    setError(e.message);
  }
};

useEffect(() => {
  setLoading(true);
  refresh().finally(() => setLoading(false));
}, []);

return (
  <>
    {loading && <Loading />}
    {error && <ErrorBanner>{error}</ErrorBanner>}
    {!loading && !error && (
      // 정상 렌더링
    )}
  </>
);
```

### 폴링 (시간표 동기화)

```javascript
useEffect(() => {
  const tick = setInterval(() => {
    refreshAll().catch(() => {});
  }, POLL_INTERVAL_MS);
  return () => clearInterval(tick);
}, [refreshAll]);
```

### 비밀 작업 (Window 이벤트)

사이드바 빨간 점 같이 다른 컴포넌트에 상태 전달 시:

```javascript
// 발송자
window.dispatchEvent(new CustomEvent('timetable:unread-count', { detail: { count } }));

// 수신자
useEffect(() => {
  const handler = (e) => setTtUnread(e.detail?.count || 0);
  window.addEventListener('timetable:unread-count', handler);
  return () => window.removeEventListener('timetable:unread-count', handler);
}, []);
```

---

## 4. API 라우트 패턴

```javascript
// api/your-endpoint.js
import { ... } from './_helper.js';  // 확장자 필수!

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 입력 검증
  const { foo, bar } = req.body;
  if (!foo) return res.status(400).json({ error: 'foo required' });

  try {
    // 작업
    const result = await doWork(foo, bar);
    return res.status(200).json({ result });
  } catch (e) {
    console.error('your-endpoint error:', e);
    return res.status(500).json({ error: e.message });
  }
}
```

---

## 5. Claude API 호출

```javascript
const response = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'claude-sonnet-4-20250514',  // 통일
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages,
    tools: TOOLS,  // tool use 시
  }),
});

if (!response.ok) {
  const err = await response.json().catch(() => ({}));
  return res.status(response.status).json({
    error: err.error?.message || `Claude API 오류 (${response.status})`,
  });
}

const data = await response.json();
```

---

## 6. 작업 스타일 (사용자와의 협업)

### 일반 흐름

```
큰 작업 결정 필요
  ↓
[Claude] 결정 사항 + 추천안 정리
  ↓
[사용자] 답변
  ↓
[Claude] 작업 시작 알림 → 단계별 진행
  ↓
[Claude] 작업 완료 + 검증 시나리오 제시
  ↓
[사용자] 배포 + 검증
  ↓
다음 작업
```

### 결정 사항 정리 형식

```markdown
## 결정 1 — XX 정책

상황 설명...

**A. 옵션 A** — 설명. 장단점.
**B. 옵션 B** — 설명. 장단점.
**C. 옵션 C** — 설명. 장단점.

저는 **B 추천** 해요. 이유...
```

### 검증 시나리오 형식

```markdown
## 검증 시나리오

1. 시나리오 1: ...
2. 시나리오 2: ...
3. 핵심 검증 포인트: ...

배포 후 확인하시고 막힌 부분 알려주세요.
```

### 작업 종료 알림

큰 작업 단계 끝나면:

```markdown
## Phase X-Y 완료

**N개 파일 업데이트**:
- `path/file.jsx` (신규/교체)

**핵심 동작**:
- 동작 1
- 동작 2

**검증 시나리오**:
...
```

### 코드 출력 패턴

새 파일이나 큰 수정은 코드 블록으로 보여주기보다 파일 시스템 도구로 만들어서 `present_files` 로 사용자에게 다운로드 링크 제공. 작은 수정은 `str_replace` 로 부분만.

---

## 7. 절대 금지 사항

### 코드
- ❌ `.env`, `.env.local` 파일 commit
- ❌ API 키 하드코딩
- ❌ `console.log` 디버깅 코드 남기기 (의도적 로깅은 `console.error`/`console.warn` 만)
- ❌ 임의로 데이터 모델 변경
- ❌ DECISIONS.md 의 결정 무시

### 협업
- ❌ 사용자가 안 요청한 큰 리팩토링
- ❌ "Phase X 에서 처리할게요" 같은 약속을 ROADMAP.md 와 다르게
- ❌ 추측 기반 답변 (모르면 "확인 필요" 명시)
- ❌ 너무 자주 사과하기 ("죄송합니다" 남발 금지)
- ❌ 결과만 제시하고 검증 안내 누락

### 사용자 요청을 임의로 확장
- ❌ "버튼 색깔 바꿔줘" 요청에 페이지 전체 리디자인
- ❌ 작은 버그 수정에 새 기능 추가
- ❌ 시범운영 보류된 AI 기능을 슬쩍 추가

---

## 8. 자주 헷갈리는 것들

### timetableData export 이름
- `SBJ` (과목) — `SUBJ` 가 아님
- `TCH`, `CLS`, `gS`, `gT`, `gC`, `CLR`

### 시드 등장 교사 ID
`t2`, `t7`, `t20`, `t12`, `t4`, `t14` 만 시뮬레이션 페르소나로 사용 가능

### Vercel API 의 ESM import
확장자 `.js` 필수

### 시간표 데이터 구조
`{ classId: { 'day-period': {sid, tid} } }` — `day-period` 형식 (예: `'월-3'`)

### 페르소나가 admin 인지 체크
- `me.isAdmin === true` — 페르소나가 'admin' 일 때
- `currentMode === 'admin' && persona === 'admin'` — 모드까지 확인

### 변동 status 흐름
```
awaiting_partners → awaiting_admin → approved
                                  ↘ rejected
```

직권 변경은 `is_admin_direct=true` 이고 status 가 바로 `approved` (단계 skip).

---

## 9. 디버깅 가이드

### 빌드 실패
- `npm run build` 로컬 확인
- "Could not resolve" 에러 → import 경로 확인 (특히 API 라우트의 `.js` 확장자)
- "is not exported" 에러 → 이름 오타 (`SBJ` vs `SUBJ` 같은)

### 배포 후 500 에러
- Vercel Dashboard → Logs → 함수 에러 메시지
- 흔한 원인: `ERR_MODULE_NOT_FOUND` (확장자 누락), `ANTHROPIC_API_KEY` 누락, Supabase 권한

### UI 변경 안 보임
- `Ctrl+Shift+R` 강제 새로고침
- 시크릿 창에서 확인
- Vercel deployment 가 새 commit 으로 빌드됐는지 확인

### 데이터 안 보임
- Supabase SQL Editor 에서 직접 쿼리
- 페르소나가 시드에 등장하는 교사인지 확인
- 활성 시간표가 존재하는지 확인 (`SELECT * FROM timetables WHERE is_active = true`)

---

이 컨벤션을 따르면 코드 일관성과 사용자 경험이 자연스럽게 유지됩니다.
