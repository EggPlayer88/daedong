import { supabase, getSession, fetchMyProfile, onAuthStateChange, signInWithGoogle, signOut } from '@daedong/shared'
import type { LegacyServices } from './contracts'

// 새로운 createClient·회원 생성·기존 프로필 변경 없이 공용 인스턴스만 재사용한다.
export const legacyServices: LegacyServices = {
  getSession, fetchMyProfile, onAuthStateChange, signInWithGoogle, signOut,
  rpc: (name, args) => supabase.rpc(name, args),
}
