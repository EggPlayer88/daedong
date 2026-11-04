import { collectionComposeText } from './validation'

// 편집기가 받을 수 있는 글만 전달한다. 제목은 한 줄이며 안내의 탭·줄바꿈은 허용한다.
export function validCollectionComposeText(title: unknown, instructions: unknown): boolean {
  try {
    const value = collectionComposeText(title, instructions)
    return !/[\u0000-\u001f\u007f-\u009f\p{Surrogate}]/u.test(value.title) &&
      !/[\u0080-\u009f\p{Surrogate}]/u.test(value.instructions)
  } catch {
    return false
  }
}
