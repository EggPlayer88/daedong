import type { PageId } from '../modules'
export const participantPage = (scope: string): PageId =>
  (({ teaching: 'students', transitions: 'schoolAdmin' })[scope] ?? scope) as PageId
