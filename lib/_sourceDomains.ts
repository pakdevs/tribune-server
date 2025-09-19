const mapPK: Record<string, string[]> = {
  dawn: ['dawn.com'],
  'geo-news': ['geo.tv'],
  'express-tribune': ['tribune.com.pk'],
  'the-news': ['thenews.com.pk'],
  'ary-news': ['arynews.tv'],
  samaa: ['samaa.tv'],
  'pakistan-today': ['pakistantoday.com.pk'],
  brecorder: ['brecorder.com'],
  'daily-times': ['dailytimes.com.pk'],
  nation: ['nation.com.pk'],
  'daily-pakistan': ['dailypakistan.com.pk', 'en.dailypakistan.com.pk'],
  'bol-news': ['bolnews.com'],
  'hum-news': ['humnews.pk'],
  '92-news': ['92news.com.pk'],
  'friday-times': ['thefridaytimes.com'],
  'pak-observer': ['pakobserver.net'],
}

const mapWorld: Record<string, string[]> = {
  cnn: ['cnn.com'],
  'bbc-news': ['bbc.com'],
  reuters: ['reuters.com'],
  'associated-press': ['apnews.com'],
  ap: ['apnews.com'],
  'the-guardian': ['theguardian.com'],
  guardian: ['theguardian.com'],
  nytimes: ['nytimes.com'],
  'the-new-york-times': ['nytimes.com'],
  'washington-post': ['washingtonpost.com'],
  'al-jazeera': ['aljazeera.com'],
  'sky-news': ['news.sky.com'],
  'fox-news': ['foxnews.com'],
  'the-verge': ['theverge.com'],
  bloomberg: ['bloomberg.com'],
  'financial-times': ['ft.com'],
}

function slugify(s = '') {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function getSourceDomains(region: 'pk' | 'world', slug: string, name?: string) {
  const s = slugify(slug)
  const n = name ? slugify(name) : ''
  const table = region === 'pk' ? mapPK : mapWorld
  if (s && table[s]) return table[s]
  if (n && table[n]) return table[n]
  return []
}
