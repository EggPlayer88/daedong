// 접힌 관리 영역을 실제 사용자 동작으로 연 뒤 기존 데이터·복구 회귀를 계속한다.
export async function openTeachingTools(page, kind) {
  const title = kind === 'course' ? '수업 등록·자료 관리' : '명부·활동 가져오기·관계 관리'
  const summary = page.getByText(title, { exact: true })
  await summary.waitFor()
  if (await summary.locator('..').getAttribute('open') === null) await summary.click()
}
