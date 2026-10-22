// 화면 크기와 메뉴 배치에 맞춰 실제 사용자가 누르는 탐색 경로를 따른다.
export async function clickWorkspaceMenu(page, name) {
  const navigation = page.getByRole('navigation', { name: /^(업무 메뉴|신축 업무 메뉴)$/ })
  const direct = navigation.getByRole('button', { name, exact: true })
  if (await direct.count() && await direct.first().isVisible()) {
    await direct.first().click()
    return
  }
  const more = page.getByRole('dialog', { name: '더보기', exact: true })
  if (!await more.isVisible()) await navigation.getByRole('button', { name: '더보기', exact: true }).click()
  await more.getByRole('button', { name, exact: true }).click()
}
