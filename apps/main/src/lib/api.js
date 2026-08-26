// API 호출 공통 — **JSON 으로 읽기 전에 정말 JSON 인지 확인한다.**
//
// 왜 이 파일이 있는가 (2026-08-26):
//   서버 함수가 죽거나 실행 시간을 넘기면 Vercel 은 우리 JSON 대신 자기 오류 페이지를
//   돌려준다. 그것을 그대로 `r.json()` 하면 브라우저가 던지는 문장이 그대로 화면에 뜬다:
//       Unexpected token 'A', "An error o"... is not valid JSON
//   교사에게 아무 뜻이 없는 문장이고, 같은 혼란이 세 번 반복됐다.
//
// 그래서 여기서 두 가지를 한다:
//   1. 사람이 읽는 문장으로 바꾼다 ("일시적인 서버 오류입니다…").
//   2. **무슨 일이었는지는 버린다.** 상태 코드를 문장 끝에 남기고 원문 앞부분을
//      콘솔에 찍는다 — 다음에 같은 일이 나면 timeout(504)인지 crash(500)인지
//      로그 없이도 갈린다. 조용히 삼키면 원인 추적이 처음으로 돌아간다.

/** 서버가 JSON 으로 답한 실패. status/body 를 그대로 들고 있어 호출부가 분기할 수 있다. */
export class ApiError extends Error {
  constructor(message, { status = 0, detail = '' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

/** 상태 코드별 사람이 읽는 문장. 코드를 붙여 두 번째 발생 때 원인을 좁힌다. */
function humanMessage(status, detail) {
  const tail = status ? ` (오류 ${status})` : ''
  if (status === 504 || status === 408) {
    return (
      '서버가 처리 시간을 넘겼습니다. 내용이 길면 대화를 나눠서 다시 시도해 주세요' + tail + '.'
    )
  }
  if (status === 502 || status === 503) {
    return '서버가 일시적으로 응답하지 못했습니다. 잠시 후 다시 시도해 주세요' + tail + '.'
  }
  if (status === 413) {
    return '보낸 내용이 너무 큽니다. 참고자료를 줄이거나 새 대화로 시작해 주세요' + tail + '.'
  }
  if (status >= 500 || status === 0) {
    return '일시적인 서버 오류입니다. 잠시 후 다시 시도해 주세요' + tail + '.'
  }
  // 4xx 인데 JSON 이 아닌 경우 (라우팅·프록시 단계) — 있는 그대로 알린다
  return `요청을 처리하지 못했습니다${tail}.${detail ? ` (${detail})` : ''}`
}

/**
 * POST + JSON 응답. **던지는 것은 사람이 읽는 문장 하나뿐이다.**
 *
 * @returns {Promise<{status:number, ok:boolean, data:object}>}
 *   서버가 JSON 으로 답했다면 상태 코드와 무관하게 여기로 온다 (400·403·409 분기는 호출부 몫).
 * @throws {ApiError} 응답이 JSON 이 아닐 때 / 네트워크가 끊겼을 때
 */
export async function postJson(url, body, token) {
  let r
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    })
  } catch (e) {
    console.error(`[api] ${url} 연결 실패:`, e)
    throw new ApiError('서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.')
  }

  const raw = await r.text().catch(() => '')
  const type = r.headers.get('content-type') || ''

  // 본문이 비어 있는 정상 응답 (204 등) 은 빈 객체로 본다
  if (!raw.trim()) {
    if (r.ok) return { status: r.status, ok: true, data: {} }
    console.error(`[api] ${url} 빈 응답 ${r.status}`)
    throw new ApiError(humanMessage(r.status, ''), { status: r.status })
  }

  // ⚠ content-type 만 믿지 않는다 — 오류 페이지가 잘못된 헤더로 오는 경우가 있다.
  //   실제로 파싱해 보고 실패하면 그때 비JSON 으로 판정한다.
  if (type.includes('json') || raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) {
    try {
      return { status: r.status, ok: r.ok, data: JSON.parse(raw) }
    } catch {
      /* 아래 비JSON 경로로 떨어진다 */
    }
  }

  const head = raw.replace(/\s+/g, ' ').trim().slice(0, 200)
  console.error(`[api] ${url} 이 JSON 이 아닌 응답을 돌려줌 ${r.status} [${type}]: ${head}`)
  throw new ApiError(humanMessage(r.status, ''), { status: r.status, detail: head })
}
