import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// 로컬 Chrome과 CI의 고정 버전 Chromium이 같은 상호작용 시험을 실행한다.
export function browserLaunchOptions(environment = process.env) {
  const channel = environment.PLAYWRIGHT_CHANNEL || 'chrome'
  if (!['chromium', 'chrome', 'msedge'].includes(channel)) throw new Error(`지원하지 않는 PLAYWRIGHT_CHANNEL: ${channel}`)
  return { headless: true, ...(channel === 'chromium' ? {} : { channel }) }
}

export function launchBrowser() {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
  return chromium.launch(browserLaunchOptions())
}
