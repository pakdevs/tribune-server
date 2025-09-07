export type RawArticle = Record<string, any>
export type NormalizedArticle = {
  id: string
  title: string
  summary: string
  content: string
  author: string
  publishDate: string
  category: string
  imageUrl: string
  hasImage: boolean
  safeImage: string
  imageAspectRatio: number | null
  url: string
  link: string
  readTime: string
  tags: string[]
  isBreaking: boolean
  likes: number
  shares: number
  sourceName: string
  displaySourceName: string
  sourceDomain: string
  sourceIcon: string
  sourceUrl: string
}

export const normalize = (raw: RawArticle | null | undefined): NormalizedArticle | null => {
  if (!raw || typeof raw !== 'object') return null
  const id = String(
    (raw as any).id ||
      (raw as any)._id ||
      (raw as any).guid ||
      (raw as any).url ||
      (raw as any).link ||
      `${(raw as any).source?.name || 'src'}-${
        (raw as any).publishedAt || (raw as any).pubDate || Date.now()
      }`
  )
  const title = String((raw as any).title || (raw as any).heading || 'Untitled')
  const summary = String(
    (raw as any).summary ||
      (raw as any).highlightText ||
      (raw as any).highlightTitle ||
      (raw as any).description ||
      (raw as any).excerpt ||
      (raw as any).contentSnippet ||
      ''
  )
  const content = String(
    (raw as any).content || (raw as any).fullContent || (raw as any).body || (raw as any).text || ''
  )
  const author = String(
    (raw as any).author || (raw as any).creator || (raw as any).byline || 'Unknown'
  )
  const publishDate = String(
    (raw as any).publishDate || (raw as any).publishedAt || (raw as any).pubDate || ''
  )
  const category = String(
    (raw as any).category || (raw as any).section || (raw as any).topic || 'general'
  )
  const imageUrl = String(
    (raw as any).imageUrl ||
      (raw as any).urlToImage ||
      (raw as any).image_url ||
      (raw as any).image ||
      (raw as any).main_image ||
      (raw as any).thumbnail ||
      (raw as any).enclosure?.url ||
      ''
  )

  let sourceName: string =
    (raw as any).source?.name ||
    (raw as any).source_name ||
    (raw as any).sourceName ||
    (raw as any).source_id ||
    (raw as any).source ||
    (raw as any).publisher ||
    (raw as any).site ||
    (raw as any).site_full ||
    (raw as any).domain ||
    (raw as any).rights ||
    (raw as any).newsSite ||
    ''

  const sourceUrl = String(
    (raw as any).sourceUrl ||
      (raw as any).link ||
      (raw as any).url ||
      (raw as any).thread?.url ||
      ''
  )
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
  let displaySourceName = sourceName
  if (sourceDomain && (!displaySourceName || displaySourceName === sourceDomain)) {
    const base = sourceDomain.split('.')
    if (base.length > 1) {
      displaySourceName = base[0]
    }
  } else if (displaySourceName) {
    displaySourceName = displaySourceName.replace(
      /\.(com|net|org|pk|co|io|news)(\.[a-z]{2})?$/i,
      ''
    )
  }
  displaySourceName = displaySourceName
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  const sourceIcon = sourceDomain
    ? `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(sourceDomain)}`
    : ''
  const hasImage = !!imageUrl
  const safeImage = imageUrl
  const imageAspectRatio: number | null = null

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
    url: sourceUrl,
    link: sourceUrl,
    readTime: '3 min read',
    tags: Array.isArray((raw as any).tags) ? (raw as any).tags : [],
    isBreaking: !!((raw as any).isBreaking || (raw as any).breaking),
    likes: Number((raw as any).likes || 0),
    shares: Number((raw as any).shares || 0),
    sourceName,
    displaySourceName,
    sourceDomain,
    sourceIcon,
    sourceUrl,
  }
}
