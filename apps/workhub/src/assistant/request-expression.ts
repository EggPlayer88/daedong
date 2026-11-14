// 명시적인 부탁의 종결만 공유한다. 본문을 바꾸거나 실행·대상 선택을 대신하지 않는다.
export const assistantRequestEnding = '(?:줘|주세요|주십시오|주시겠어요|줄래요?|주실래요|줄\\s*수\\s*(?:있어|있나요|있을까요)|주실\\s*수\\s*(?:있나요|있을까요))'
export const assistantDataPrefix = /^(?:(?:[^:：\r\n]+\s+)?(?:검색|찾기)|할\s*일\s*(?:추가|등록|작성)|(?:메시지|(?:자료\s*)?수합|일정)\s*초안)\s*[:：]/

// 콜론 뒤 명시 데이터와 인용문은 실행 요청 수에 넣지 않는다.
// 본문의 '자료 준비해 주세요'가 아니라 업무 종류까지 명시한 작성 요청만 센다.
export function hasMultipleAssistantRequests(text: string): boolean {
  if (assistantDataPrefix.test(text)) return false
  const outside = text.replace(/\[[^\]\r\n]*\]|“[^”]*”|‘[^’]*’|"[^"\r\n]*"|'[^'\r\n]*'/g, '')
  const task = '할\\s*일(?:로|에)?\\s*(?:만들어|작성해|추가해|등록해|넣어)'
  const calendar = '일정(?:\\s*초안)?(?:을|를)?\\s*(?:만들어|작성해|추가해|등록해|잡아|넣어)'
  const draft = '(?:메시지|(?:자료\\s*)?수합)(?:\\s*초안)?(?:을|를|으로)?\\s*(?:(?:하나|한\\s*건)\\s*)?(?:만들어|작성해|써|준비해)'
  const collection = '수합(?:해|\\s*요청해|\\s*받아)'
  const endings = new RegExp('(?:' + [task, calendar, draft, collection].join('|') + ')\\s*' + assistantRequestEnding + '(?=$|[\\s.!?。！？,，])', 'g')
  return [...outside.matchAll(endings)].length > 1
}
