// Load environment variables for local development. In production (Vercel),
// env vars are provided by the platform and this import is a no-op.
import 'dotenv/config'

// Primary provider key for NewsData.io
export function getNewsDataApiKey(): string | undefined {
  if ((process as any).env.NEWSDATA_API) return (process as any).env.NEWSDATA_API
  // Legacy fallbacks (none for NewsData.io); return undefined if missing
  return undefined
}

// Webz.io API key (set WEBZ_API in Vercel env)
export function getWebzApiKey(): string | undefined {
  const key = (process as any).env.WEBZ_API
  return key ? String(key) : undefined
}
