// 화면 크기와 메뉴 배치에 맞춰 실제 사용자가 누르는 탐색 경로를 따른다.
export async function clickWorkspaceMenu(page, name) {
  const navigation = page.getByRole('navigation', { name: /^(업무 메뉴|신축 업무 메뉴)$/ })
  const primary = { '오늘': '홈', '내 업무': '업무', '문서함': '자료' }[name] ?? name
  const direct = navigation.getByRole('button', { name: primary, exact: true })
  // 재로그인 직후 옛 DOM의 개수를 보고 더보기로 우회하지 않고 실제 핵심 버튼을 기다린다.
  if (primary !== name || name === '시간표') { await direct.click(); return }
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
