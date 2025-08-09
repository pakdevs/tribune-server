export const normalize = (raw) => {
  if (!raw || typeof raw !== 'object') return null
  const id = String(
    raw.id ||
      raw._id ||
      raw.guid ||
      raw.url ||
      raw.link ||
      `${raw.source?.name || 'src'}-${raw.publishedAt || raw.pubDate || Date.now()}`
  )
  const title = String(raw.title || raw.heading || 'Untitled')
  const summary = String(raw.summary || raw.description || raw.excerpt || raw.contentSnippet || '')
  const content = String(raw.content || raw.fullContent || raw.body || '')
  const author = String(raw.author || raw.creator || raw.byline || 'Unknown')
  const publishDate = String(
    raw.publishDate || raw.publishedAt || raw.pubDate || new Date().toISOString()
  )
  const category = String(raw.category || raw.section || raw.topic || 'general')
  const imageUrl = String(
    raw.imageUrl || raw.urlToImage || raw.image || raw.thumbnail || raw.enclosure?.url || ''
  )

  // Try multiple possible fields for source name across providers
  let sourceName =
    raw.source?.name ||
    raw.source_name ||
    raw.sourceName ||
    raw.source_id ||
    raw.source ||
    raw.publisher ||
    raw.site ||
    raw.domain ||
    raw.rights ||
    raw.newsSite ||
    ''

  const sourceUrl = String(raw.sourceUrl || raw.link || raw.url || '')
  let sourceDomain = ''
  if (sourceUrl) {
    try {
      sourceDomain = new URL(sourceUrl).hostname.replace(/^www\./, '')
    } catch {}
  }

  if (!sourceName && sourceUrl) {
    try {
      const host = new URL(sourceUrl).hostname.replace(/^www\./, '')
      sourceName = host
    } catch {}
  }

  sourceName = String(sourceName)
  // Create a display variant without common TLDs (keep first label(s) before TLD)
  let displaySourceName = sourceName
  if (sourceDomain && (!displaySourceName || displaySourceName === sourceDomain)) {
    // Strip country/generic TLDs (.com, .pk, .net, .org, etc.) keeping first segment before first dot
    const base = sourceDomain.split('.')
    if (base.length > 1) {
      // If domain like dailytimes.com.pk keep dailytimes
      displaySourceName = base[0]
    }
  } else if (displaySourceName) {
    // Remove trailing .com, .pk etc from an already chosen name if it matches a domain pattern
    displaySourceName = displaySourceName.replace(
      /\.(com|net|org|pk|co|io|news)(\.[a-z]{2})?$/i,
      ''
    )
  }
  // Capitalize words
  displaySourceName = displaySourceName
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  // Simple icon (browser favicon service). Consumers can fall back to initials.
  const sourceIcon = sourceDomain
    ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(sourceDomain)}`
    : ''
  // Lightweight media stubs
  const hasImage = !!imageUrl
  const safeImage = imageUrl
  const imageAspectRatio = null

  return {
    id,
    title,
    summary,
    content,
    author,
    publishDate,
    category,
    imageUrl,
    hasImage,
    safeImage,
    imageAspectRatio,
    url: sourceUrl, // alias
    link: sourceUrl, // alias
    readTime: '3 min read',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    isBreaking: !!(raw.isBreaking || raw.breaking),
    likes: Number(raw.likes || 0),
    shares: Number(raw.shares || 0),
    sourceName, // raw / original best-effort
    displaySourceName,
    sourceDomain,
    sourceIcon,
    sourceUrl,
  }
}
