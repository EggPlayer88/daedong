export interface FileReference { id: string; name: string; extension: string; bytes: number; sha256: string }
export interface FilePolicy { extensions: string[]; maxFileBytes: number; maxFiles: number }
export interface FileOwnerScope { schoolId: string; memberId: string }
// 수합 권한을 확인한 호출자가 읽기를 허용한 원본 소유자 목록이다.
export interface FileReadScope { schoolId: string; memberIds: string[] }
export interface CollectionFileRepository {
  stage(file: File, policy: FilePolicy, owner: FileOwnerScope, signal?: AbortSignal): Promise<FileReference>
  check(refs: readonly FileReference[], policy: FilePolicy, scope: FileReadScope): void
  read(ref: FileReference, scope: FileReadScope, signal?: AbortSignal): Promise<Blob>
  // 저장 성공한 원본은 초기화 전까지 선택 취소·제거로 회수하지 않는다.
  retainSaved?(refs: readonly FileReference[]): void
  // 해당 선택기에서 stage한 미저장 참조만 회수하며 저장 이력의 원본은 보존한다.
  discardStaged(refs: readonly FileReference[], owner: FileOwnerScope): void
  reset(): void
}
const messages = {
  FILE_POLICY_INVALID: '파일 규칙을 확인해 주세요.', FILE_TYPE_UNSUPPORTED: '허용된 문서 확장자를 선택해 주세요.',
  FILE_NAME_INVALID: '파일 이름을 확인해 주세요.', FILE_SIZE_LIMIT: '파일 크기가 허용 범위를 벗어났습니다.',
  FILE_COUNT_LIMIT: '첨부할 수 있는 파일 수를 초과했습니다.', FILE_DUPLICATE: '같은 이름이나 내용의 파일이 중복되었습니다.',
  FILE_SIGNATURE_MISMATCH: '파일 내용의 기본 형식과 확장자가 맞지 않습니다.', FILE_MIME_MISMATCH: '파일 형식 정보를 확인해 주세요.',
  FILE_UNAVAILABLE: '현재 탭에서 이 파일을 찾거나 확인할 수 없습니다. 원본을 다시 선택해 주세요.',
  FILE_SCOPE_DENIED: '현재 범위에서는 이 파일을 읽을 수 없습니다.', FILE_ABORTED: '파일 작업을 취소했습니다.',
  FILE_TIMEOUT: '파일 처리 시간이 초과되었습니다. 다시 시도해 주세요.', FILE_READ_FAILED: '파일을 읽지 못했습니다. 원본을 다시 확인해 주세요.',
  FILE_CRYPTO_UNAVAILABLE: '파일 확인에는 HTTPS 또는 localhost의 암호화 기능이 필요합니다.',
  FILE_MEMORY_LIMIT: '현재 창의 파일 보관 한도를 초과했습니다. 필요한 파일을 내려받은 뒤 미리보기를 새로 열어 주세요.', FILE_DOWNLOAD_FAILED: '파일 다운로드를 시작하지 못했습니다. 다시 시도해 주세요.',
  FILE_ZIP_LIMIT: '묶음 다운로드의 처리 한도를 초과했습니다.',
} as const
export type FileErrorCode = keyof typeof messages
export class FileError extends Error {
  constructor(readonly code: FileErrorCode) { super(messages[code]); this.name = 'FileError' }
}
// 업무 정책이 아니라 현재 메모리 구현을 보호하는 기술 상한이다.
export const FILE_TECHNICAL_LIMITS = Object.freeze({ memoryBytes: 100 * 1024 * 1024, timeoutMs: 15000, zipEntries: 512, nameBytes: 240 })
