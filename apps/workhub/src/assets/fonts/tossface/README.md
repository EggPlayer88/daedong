# Tossface 배포 자산

공식 [toss/tossface v1.6.1](https://github.com/toss/tossface/tree/v1.6.1)의 웹 글꼴을 2026-10-26에 가져왔다. 글꼴 파일은 수정하거나 다시 인코딩하지 않았다.

- 출처: `dist/tossface.css`, `dist/TossFaceFontMac-07.woff2`, `dist/TossFaceFontMac-08.woff2`, `dist/TossFaceFontMac-09.woff2`, `LICENSE`
- `upstream.css`: 공식 원본 CSS를 보관한다.
- `tossface.css`: 현재 메뉴에서 사용하는 문자 범위 07–09의 원래 `unicode-range`를 유지한다. 경로만 로컬 파일로 연결하고 `font-display: swap`을 사용한다.
- 세 파일 합계 약 3.23 MB. `unicode-range`에 따라 필요한 글꼴을 브라우저가 가져오며, Vite가 해시 파일명으로 빌드한다. 외부 CDN은 사용하지 않는다.
- `LICENSE.txt`: 라이선스 전문. `license.ts`는 같은 전문과 저작권 안내를 앱의 ‘글꼴 라이선스’에 표시한다.
- 저작권: Copyright (c) 2022, 2023 Viva Republica, with Reserved Font Name Tossface.

| 파일 | SHA-256 |
| --- | --- |
| 07 | `2ed1fbfa9911e6b660e30bc161e227004cd5b64059bee91f2ef7396454598a46` |
| 08 | `71cc01dd972da6662b30b5a38300a94d2d9167f183128adba204838ee92ecf4f` |
| 09 | `edd63102886c65e1a0c7a81c340dd544b22a63d6fa1fde0817f35344bd72df54` |

확대·닫기·검색 등의 조작 기호는 기존 SVG/텍스트를 유지한다. 색깔 이모지는 메뉴의 범주를 돕는 장식이며 항상 문자 레이블과 함께 제공한다. 지원하지 않는 글리프는 OS 이모지로 대체된다.
