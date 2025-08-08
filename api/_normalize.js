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
  const sourceName = String(raw.source?.name || raw.source || raw.rights || '')
  const sourceUrl = String(raw.sourceUrl || raw.link || raw.url || '')
  return {
    id,
    title,
    summary,
    content,
    author,
    publishDate,
    category,
    imageUrl,
    // Common aliases so clients can open the source article directly
    url: sourceUrl,
    link: sourceUrl,
    readTime: '3 min read',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    isBreaking: !!(raw.isBreaking || raw.breaking),
    likes: Number(raw.likes || 0),
    shares: Number(raw.shares || 0),
    sourceName,
    sourceUrl,
  }
}
