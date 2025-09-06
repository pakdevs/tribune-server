// Load environment variables for local development. In production (Vercel),
// env vars are provided by the platform and this import is a no-op.
import 'dotenv/config'

export function getNewsApiKey(): string | undefined {
  // Primary key
  if ((process as any).env.NEWSAPI_KEY) return (process as any).env.NEWSAPI_KEY
  // Accept a common alias if present
  if ((process as any).env.NEWS_API_KEY) return (process as any).env.NEWS_API_KEY
  return undefined
}
