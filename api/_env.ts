// Load environment variables for local development. In production (Vercel),
// env vars are provided by the platform and this import is a no-op.
import 'dotenv/config'

export function getNewsApiKey(): string | undefined {
  // Primary key (preferred)
  if ((process as any).env.NEWSAPI_ORG) return (process as any).env.NEWSAPI_ORG
  // Backwards-compatible fallbacks
  if ((process as any).env.NEWSAPI_KEY) return (process as any).env.NEWSAPI_KEY
  if ((process as any).env.NEWS_API_KEY) return (process as any).env.NEWS_API_KEY
  return undefined
}
