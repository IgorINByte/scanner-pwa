/** Injected by vite.config.ts (define). */
declare const __APP_COMMIT__: string
declare const __APP_BUILD_DATE__: string

declare module 'libheif-js/wasm-bundle' {
  const libheif: unknown
  export default libheif
}
