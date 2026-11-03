// 화면 크기와 메뉴 배치에 맞춰 실제 사용자가 누르는 탐색 경로를 따른다.
export async function clickWorkspaceMenu(page, name) {
  const navigation = page.getByRole('navigation', { name: /^(업무 메뉴|신축 업무 메뉴|허용된 업무)$/ })
  await navigation.waitFor({ state: 'visible' })
  const primary = { '오늘': '홈', '업무': '내 업무', '학교 일정': '일정', '문서함': '문서·자료', '자료': '문서·자료', '수업과 학생': '수업·학생' }[name] ?? name
  const direct = navigation.getByRole('button', { name: primary, exact: true })
  // 모바일에서 접힌 핵심 메뉴도 전체 메뉴를 통해 같은 원본 화면으로 이동한다.
  if (await direct.count() && await direct.first().isVisible()) {
    await direct.first().click()
    return
  }
  const related = page.getByRole('navigation', { name: '관련 업무 메뉴', exact: true }).getByRole('button', { name, exact: true })
  if (await related.isVisible()) { await related.click(); return }
  const header = page.locator('.ws-header-actions').getByRole('button', { name, exact: true })
  if (await header.isVisible()) { await header.click(); return }
  const more = page.getByRole('dialog', { name: '더보기', exact: true })
  if (!await more.isVisible()) await navigation.getByRole('button', { name: '더보기', exact: true }).click()
  await more.getByRole('button', { name, exact: true }).click()
}
