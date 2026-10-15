import { getSession } from '@daedong/shared'
import { createBasicFileCheck } from './basic-file-check'

// 기존 공용 로그인 세션을 재사용한다. 서버 키는 브라우저에 전달하지 않는다.
export const legacyBasicFileCheck = createBasicFileCheck({ getSession })
