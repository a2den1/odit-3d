/// <reference types="vite/client" />
import type { OditApi } from '../electron/preload'

declare global {
  interface Window { odit: OditApi }
}
export {}
