declare module '@daedong/shared' {
  export const supabase: {
    rpc: import('./contracts').LegacyServices['rpc']
    storage: { from(bucket: string): {
      upload(path: string, file: File, options: { upsert: false; cacheControl: string; contentType: string }): Promise<{ data: unknown; error: unknown }>
      download(path: string): Promise<{ data: Blob | null; error: unknown }>
    } }
  }
  export const getSession: import('./contracts').LegacyServices['getSession']
  export const fetchMyProfile: import('./contracts').LegacyServices['fetchMyProfile']
  export const onAuthStateChange: import('./contracts').LegacyServices['onAuthStateChange']
  export const signInWithGoogle: import('./contracts').LegacyServices['signInWithGoogle']
  export const signOut: import('./contracts').LegacyServices['signOut']
}
