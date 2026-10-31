import type { useGuidedEditor } from './useGuidedEditor'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function GuidedFileSection({
  model,
}: {
  model: Pick<
    ReturnType<typeof useGuidedEditor>,
    | 'currentArtifact'
    | 'download'
    | 'downloaded'
    | 'input'
    | 'locked'
    | 'reviewed'
    | 'setReviewed'
    | 'target'
    | 'template'
  >
}) {
  const {
    currentArtifact,
    download,
    downloaded,
    input,
    locked,
    reviewed,
    setReviewed,
    target,
    template,
  } = model
  if (!template) return null
  return (
    <>
      {currentArtifact && (
        <section
          className="documents-status"
          data-document-step="file"
          tabIndex={-1}
          aria-label="생성한 HWPX 확인"
        >
          <h4>생성 파일 확인</h4>
          <p>
            v{currentArtifact.templateVersion} 양식 · 응답 v{currentArtifact.responseVersion}
          </p>
          <button type="button" disabled={locked} onClick={() => void download(currentArtifact)}>
            생성 HWPX 내려받기
          </button>
          <label className="documents-check">
            <input
              type="checkbox"
              checked={reviewed}
              disabled={!downloaded || locked}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            파일을 열어 내용과 칸 배치를 확인했습니다
          </label>
        </section>
      )}
    </>
  )
}
