# Pretendard 한국어 가변 글꼴

UI 글꼴은 **Pretendard v1.3.9**의 한국어 원본을 그대로 보관한다. 실행 중 CDN이나 외부 글꼴 서비스에 요청하지 않고 이 자산을 배포한다.

| 파일 | 크기 | 용도 |
|---|---:|---|
| `PretendardVariable.woff2` | 2,057,688 bytes (약 1.96 MiB) | 한국어·라틴 문자를 포함한 가변 글꼴 |
| `LICENSE-Pretendard.txt` | 4,418 bytes | 원본 저작권 표시와 SIL Open Font License 1.1 전문 |

- 공식 저장소: <https://github.com/orioncactus/pretendard>
- 고정 버전 글꼴: <https://github.com/orioncactus/pretendard/blob/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2>
- 고정 버전 라이선스: <https://github.com/orioncactus/pretendard/blob/v1.3.9/LICENSE>
- 공식 CSS: <https://github.com/orioncactus/pretendard/blob/v1.3.9/packages/pretendard/dist/web/variable/pretendardvariable.css>
- 원저작자: Kil Hyung-jin. Reserved Font Name: Pretendard.
- 확인일: 2026-10-13. 파일 변환·수정·서브셋 생성 없음.

## 원본 확인

| 파일 | SHA-256 |
|---|---|
| 글꼴 | `9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4` |
| 라이선스 | `d31ddd9f2bed32fd7e302a205cf2380ba0de6529152d239ef99cfb6f261bfc04` |

공식 GitHub blob ID와도 일치한다: 글꼴 `49c54b5152a184a243e85f7281ed338b6569987e`, 라이선스 `c0592ca0072da4537bdc064eb935d88e9bb4361d`.

원본 WOFF2 헤더·길이 검사와 Chrome `FontFace.load()`를 통과했다. 한국어 표본을 포함한 `document.fonts.check()`가 참이고 외부 HTTP 요청은 0건이었다. 제품 진입점·ShadowRoot·독립 HTML 통합 이후에는 각 화면에서 별도로 확인한다.

## 통합 기준

- 공식 선언은 `font-family: 'Pretendard Variable'`, `font-weight: 45 920`, `font-style: normal`, `font-display: swap`이다. 이 범위에서 일반 본문·제목 굵기를 선택한다.
- `@font-face`는 문서 전역에 한 번 등록하고, `font-family`는 신축 UI 안에서만 적용한다. 연결 화면의 ShadowRoot 내부에는 같은 family 이름을 사용한다. 기존 운영 화면의 본문 글꼴을 덮어쓰지 않는다.
- Vite는 저장소 자산 URL로, 독립 HTML은 WOFF2를 `data:` URL로 포함한다. 독립 HTML의 글꼴 데이터는 Base64 때문에 약 2.62 MiB 늘어난다. 실제 외부 요청 없음과 글꼴 로드를 브라우저에서 확인한다.
- 글꼴과 함께 위 라이선스 전문·저작권 표시를 배포한다. 저장소에만 라이선스가 남고 실제 HTML·배포 결과에서 사라지지 않도록 확인한다.
- 로드 실패 또는 UI 회귀시험에서는 시스템 한국어 글꼴로 읽을 수 있어야 한다. 글꼴 때문에 기능 초기화를 막지 않는다.

업데이트 시 공식 고정 버전의 파일과 라이선스를 함께 교체하고 크기·해시·브라우저 로드를 다시 확인한다.
