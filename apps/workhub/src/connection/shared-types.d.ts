declare module '@daedong/shared' {
  export const supabase: { rpc: import('./contracts').LegacyServices['rpc'] }
  export const getSession: import('./contracts').LegacyServices['getSession']
  export const fetchMyProfile: import('./contracts').LegacyServices['fetchMyProfile']
  export const onAuthStateChange: import('./contracts').LegacyServices['onAuthStateChange']
  export const signInWithGoogle: import('./contracts').LegacyServices['signInWithGoogle']
  export const signOut: import('./contracts').LegacyServices['signOut']
}
