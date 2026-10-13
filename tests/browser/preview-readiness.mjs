import { stripVTControlCharacters } from 'node:util'

// CI의 Vite는 포트 번호에도 ANSI 서식을 넣으므로 소유 프로세스의 주소를 평문으로 확인한다.
export function hasPreviewUrl(log, url) {
  return stripVTControlCharacters(log).includes(url)
}
