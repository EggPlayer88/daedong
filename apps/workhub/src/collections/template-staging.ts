import { FileError, type FilePolicy } from '../files/contracts'
import { hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import { validateFileMetadata } from '../files/validation'

export type StagedTemplate = { id: string; file: File }

// 선택 단계에는 서버에 쓰지 않는다. 일부만 몰래 선택되는 일을 피하려고 묶음 전체를 먼저 검사한다.
export function stageTemplates(current: StagedTemplate[], files: File[], policy: FilePolicy, attached: number, makeId = () => crypto.randomUUID()): StagedTemplate[] {
  const checked = hwpxCollectionPolicy(policy)
  if (attached + current.length + files.length > checked.maxFiles) throw new Error(`양식은 최대 ${checked.maxFiles}개까지 선택할 수 있습니다.`)
  for (const file of files) {
    try { validateFileMetadata(file, checked) }
    catch (error) {
      if (error instanceof FileError && error.code === 'FILE_TYPE_UNSUPPORTED') throw new Error('HWPX 파일만 선택할 수 있습니다. 한글에서 HWPX 형식으로 저장해 주세요.')
      throw error
    }
  }
  return [...current, ...files.map(file => ({ id: makeId(), file }))]
}
