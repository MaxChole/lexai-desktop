export interface WebSearchSource {
  title: string;
  url: string;
  snippet: string;
  source: string;
  authority: 'official' | 'reference' | 'secondary';
}

export interface WebSearchResult {
  provider: 'searxng' | 'bing-rss' | 'wikipedia';
  query: string;
  sources: WebSearchSource[];
  context: string;
}

type SearchJurisdiction = 'CN' | 'US' | 'INT' | 'CROSS';

interface WikipediaSearchRow {
  title: string;
  snippet?: string;
  pageid?: number;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&#x27;/g, '\'');
}

function truncate(value: string, max = 320): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractKeywordTerms(value: string): string[] {
  const baseTerms = (value.match(/[\p{Script=Han}A-Za-z0-9_-]{2,}/gu) || [])
    .map((item) => item.trim())
    .filter(Boolean);
  const splitTerms = baseTerms.flatMap((item) => item.split(/[的与及和或]/u).map((part) => part.trim()));
  return Array.from(new Set([...baseTerms, ...splitTerms].filter((item) => item.length >= 2)));
}

function extractLawTitles(value: string): string[] {
  const matches = value.match(/[\p{Script=Han}A-Za-z0-9《》]{2,}?(?:法|条例|规定|办法|规则|指引|公约|宪章)/gu) || [];
  return Array.from(new Set(matches.map((item) => item.replace(/[《》]/g, '').trim()).filter((item) => item.length >= 4)));
}

function sanitizeQuery(rawQuery: string): string {
  const sanitized = rawQuery
    .replace(/[，。！？、；：“”‘’"'`()【】[\]{}<>]/g, ' ')
    .replace(/\b(please|sources?|reference|references)\b/gi, ' ')
    .replace(/请结合公开资料|结合公开资料|根据公开资料|联网查询|联网搜索|联网增强/gu, ' ')
    .replace(/请你|请问|请|帮我|帮忙/gu, ' ')
    .replace(/说明|总结|概述|介绍|分析|列出|整理|解释|告诉我|给我/gu, ' ')
    .replace(/并给出来源|给出来源|附上来源|附来源|标注来源/gu, ' ')
    .replace(/是什么|有哪些|怎么做|如何处理/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const terms = extractKeywordTerms(sanitized);
  return terms.length > 0 ? terms.slice(0, 8).join(' ') : normalizeWhitespace(rawQuery);
}

function getHostname(url: string): string {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getDomainWeight(hostname: string, jurisdiction: SearchJurisdiction): number {
  if (!hostname) return 0;

  if (jurisdiction === 'CN' || jurisdiction === 'CROSS') {
    if (
      hostname.endsWith('.gov.cn')
      || hostname.includes('npc.gov.cn')
      || hostname.includes('cac.gov.cn')
      || hostname.includes('court.gov.cn')
    ) {
      return 6;
    }
  }

  if (jurisdiction === 'US' || jurisdiction === 'INT' || jurisdiction === 'CROSS') {
    if (
      hostname.endsWith('.gov')
      || hostname.endsWith('.gov.uk')
      || hostname.endsWith('.europa.eu')
      || hostname.endsWith('.org')
    ) {
      return 4;
    }
  }

  if (hostname.includes('wikipedia.org')) return 1;
  if (hostname.includes('baike.baidu.com')) return -2;
  if (hostname.includes('zdic.net') || hostname.includes('hanyuguoxue.com') || hostname.includes('hgcha.com')) return -3;

  return 0;
}

function classifyAuthority(hostname: string, jurisdiction: SearchJurisdiction): 'official' | 'reference' | 'secondary' {
  if (!hostname) return 'secondary';

  if (jurisdiction === 'CN' || jurisdiction === 'CROSS') {
    if (
      hostname.endsWith('.gov.cn')
      || hostname.includes('npc.gov.cn')
      || hostname.includes('cac.gov.cn')
      || hostname.includes('court.gov.cn')
    ) {
      return 'official';
    }
  }

  if (jurisdiction === 'US' || jurisdiction === 'INT' || jurisdiction === 'CROSS') {
    if (
      hostname.endsWith('.gov')
      || hostname.endsWith('.gov.uk')
      || hostname.endsWith('.europa.eu')
    ) {
      return 'official';
    }
  }

  if (
    hostname.includes('wikipedia.org')
    || hostname.includes('baike.baidu.com')
    || hostname.includes('.edu')
    || hostname.endsWith('.org')
  ) {
    return 'reference';
  }

  return 'secondary';
}

function scoreSource(
  source: WebSearchSource,
  queryTerms: string[],
  jurisdiction: SearchJurisdiction,
  lawTitles: string[],
): number {
  const haystack = `${source.title} ${source.snippet} ${source.url}`.toLowerCase();
  const hostname = getHostname(source.url);
  const overlap = queryTerms.reduce((count, term) => (
    haystack.includes(term.toLowerCase()) ? count + 1 : count
  ), 0);
  const lawHit = lawTitles.reduce((count, title) => (
    haystack.includes(title.toLowerCase()) ? count + 1 : count
  ), 0);
  return overlap * 3 + lawHit * 6 + getDomainWeight(hostname, jurisdiction);
}

function dedupeSources(sources: WebSearchSource[]): WebSearchSource[] {
  const seen = new Set<string>();
  return sources.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export class FreeWebSearch {
  constructor(private readonly searxngBaseUrl?: string) {}

  async search(query: string, jurisdiction: SearchJurisdiction): Promise<WebSearchResult | null> {
    const normalizedQuery = sanitizeQuery(query);
    if (!normalizedQuery) return null;

    if (this.searxngBaseUrl) {
      try {
        const searxngResult = await this.searchSearxng(normalizedQuery, jurisdiction);
        if (searxngResult.sources.length > 0) {
          return searxngResult;
        }
      } catch {
        // Fall back to Wikipedia below.
      }
    }

    try {
      const bingResult = await this.searchBingRss(normalizedQuery, jurisdiction);
      if (bingResult.sources.length > 0) {
        return bingResult;
      }
    } catch {
      // Fall back to Wikipedia below.
    }

    const wikipediaResult = await this.searchWikipedia(normalizedQuery, jurisdiction);
    return wikipediaResult.sources.length > 0 ? wikipediaResult : null;
  }

  private async searchBingRss(query: string, jurisdiction: SearchJurisdiction): Promise<WebSearchResult> {
    const queryTerms = extractKeywordTerms(query);
    const lawTitles = extractLawTitles(query);
    const candidateQueries = this.buildBingQueries(query, jurisdiction);
    const sourcePool: WebSearchSource[] = [];

    for (const candidateQuery of candidateQueries) {
      const url = new URL('https://www.bing.com/search');
      url.searchParams.set('q', candidateQuery);
      url.searchParams.set('format', 'rss');
      url.searchParams.set('setlang', jurisdiction === 'CN' ? 'zh-Hans' : 'en-US');
      url.searchParams.set('cc', jurisdiction === 'CN' ? 'cn' : 'us');

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`Bing RSS search error: ${response.status}`);
      }

      const xml = await response.text();
      const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 5);
      sourcePool.push(...items.map((match) => {
        const itemXml = match[1] || '';
        const title = decodeHtmlEntities((itemXml.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '').trim());
        const link = decodeHtmlEntities((itemXml.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '').trim());
        const description = decodeHtmlEntities(stripHtml((itemXml.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '').trim()));
        const hostname = getHostname(link);
        return {
          title: truncate(title),
          url: link,
          snippet: truncate(description),
          source: 'Bing RSS',
          authority: classifyAuthority(hostname, jurisdiction),
        };
      }).filter((item) => item.title && item.url));
    }

    const rankedSources = dedupeSources(sourcePool)
      .map((item) => ({
        item,
        score: scoreSource(item, queryTerms, jurisdiction, lawTitles),
      }))
      .filter(({ item, score }) => {
        if (score <= 0) {
          return false;
        }

        if (lawTitles.length === 0) {
          return true;
        }

        const haystack = `${item.title} ${item.snippet} ${item.url}`.toLowerCase();
        return lawTitles.some((title) => haystack.includes(title.toLowerCase()));
      })
      .sort((left, right) => right.score - left.score)
      .map(({ item, score }) => ({ ...item, score }));

    const authoritativeHits = rankedSources.filter((item) => item.authority === 'official');
    const filteredSources = authoritativeHits.length >= 2
      ? rankedSources.filter((item) => item.authority !== 'secondary')
      : rankedSources;

    const sources = filteredSources.slice(0, 5).map(({ score: _score, ...item }) => item);

    return {
      provider: 'bing-rss',
      query,
      sources,
      context: this.buildContextBlock(query, sources),
    };
  }

  private buildBingQueries(query: string, jurisdiction: SearchJurisdiction): string[] {
    const lawTitles = extractLawTitles(query);
    const queries = [query];
    if (jurisdiction === 'CN') {
      queries.unshift(`${query} site:gov.cn`);
      queries.push(`${query} site:npc.gov.cn`);
      queries.push(`${query} site:cac.gov.cn`);
    } else if (jurisdiction === 'US' || jurisdiction === 'INT') {
      queries.unshift(`${query} site:gov`);
      queries.push(`${query} site:justice.gov`);
    } else if (jurisdiction === 'CROSS') {
      queries.unshift(`${query} site:gov.cn`);
      queries.push(`${query} site:gov`);
    }

    for (const lawTitle of lawTitles) {
      if (jurisdiction === 'CN' || jurisdiction === 'CROSS') {
        queries.unshift(`${lawTitle} site:npc.gov.cn`);
        queries.push(`${lawTitle} 解读 site:gov.cn`);
      }
      if (jurisdiction === 'US' || jurisdiction === 'INT' || jurisdiction === 'CROSS') {
        queries.push(`${lawTitle} site:gov`);
      }
    }

    return Array.from(new Set(queries));
  }

  private getWikipediaLanguages(jurisdiction: SearchJurisdiction): string[] {
    switch (jurisdiction) {
      case 'CN':
        return ['zh'];
      case 'US':
      case 'INT':
        return ['en'];
      case 'CROSS':
        return ['zh', 'en'];
      default:
        return ['en'];
    }
  }

  private async searchWikipedia(query: string, jurisdiction: SearchJurisdiction): Promise<WebSearchResult> {
    const languages = this.getWikipediaLanguages(jurisdiction);
    const sourceGroups = await Promise.all(languages.map(async (language) => {
      const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
      url.searchParams.set('action', 'query');
      url.searchParams.set('list', 'search');
      url.searchParams.set('format', 'json');
      url.searchParams.set('origin', '*');
      url.searchParams.set('utf8', '1');
      url.searchParams.set('srlimit', language === 'zh' ? '3' : '2');
      url.searchParams.set('srsearch', query);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`Wikipedia search error: ${response.status}`);
      }

      const data = await response.json() as {
        query?: { search?: WikipediaSearchRow[] };
      };

      return (data.query?.search || []).map((item) => ({
        title: item.title,
        url: `https://${language}.wikipedia.org/?curid=${item.pageid}`,
        snippet: truncate(stripHtml(item.snippet || '')),
        source: language === 'zh' ? '维基百科' : 'Wikipedia',
        authority: 'reference' as const,
      }));
    }));

    const sources = dedupeSources(sourceGroups.flat()).slice(0, 5);
    return {
      provider: 'wikipedia',
      query,
      sources,
      context: this.buildContextBlock(query, sources),
    };
  }

  private async searchSearxng(query: string, jurisdiction: SearchJurisdiction): Promise<WebSearchResult> {
    const url = new URL('/search', this.searxngBaseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('categories', 'general');
    url.searchParams.set('language', jurisdiction === 'CN' ? 'zh-CN' : 'en-US');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`SearXNG search error: ${response.status}`);
    }

    const data = await response.json() as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        engine?: string;
      }>;
    };

    const sources = dedupeSources((data.results || [])
      .filter((item) => item.title && item.url)
      .slice(0, 5)
      .map((item) => ({
        title: truncate(item.title || ''),
        url: item.url || '',
        snippet: truncate(stripHtml(item.content || '')),
        source: item.engine || 'SearXNG',
        authority: classifyAuthority(getHostname(item.url || ''), jurisdiction),
      })));

    return {
      provider: 'searxng',
      query,
      sources,
      context: this.buildContextBlock(query, sources),
    };
  }

  private buildContextBlock(query: string, sources: WebSearchSource[]): string {
    if (sources.length === 0) {
      return '';
    }

    const sections = sources.map((item, index) => [
      `Source ${index + 1} [来源${index + 1}]`,
      `title: ${item.title}`,
      `url: ${item.url}`,
      `origin: ${item.source}`,
      `authority: ${item.authority}`,
      `snippet: ${item.snippet || '(no snippet)'}`,
    ].join('\n'));

    return [
      '# Web Search Context',
      `query: ${query}`,
      'Use these publicly retrieved references when they are relevant.',
      'Prefer grounded statements, prefer official sources over secondary summaries, and mark uncertain points with [需验证].',
      'When a statement is supported by a source, cite it inline as [来源1], [来源2], etc.',
      'Do not present unsupported legal conclusions as certain.',
      '',
      sections.join('\n\n---\n\n'),
    ].join('\n');
  }
}
