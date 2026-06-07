import fs from 'fs/promises';
import path from 'path';

const INT_PLUGIN_HINTS = new Set([
  'ai-governance-legal',
  'privacy-legal',
  'regulatory-legal',
]);

interface ParsedFrontmatter {
  name?: string;
  jurisdiction?: string;
}

function resolveReferencesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'references'),
    path.resolve(process.cwd(), '../references'),
  ];

  return candidates[0];
}

function parseFrontmatter(raw: string): { frontmatter: ParsedFrontmatter; body: string } {
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }

  const frontmatterText = match[1];
  const body = match[2];
  const frontmatter: ParsedFrontmatter = {};

  for (const line of frontmatterText.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) {
      frontmatter.name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    const jurisdictionMatch = line.match(/^jurisdiction:\s*(.+)$/);
    if (jurisdictionMatch) {
      frontmatter.jurisdiction = jurisdictionMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }
  }

  return { frontmatter, body };
}

function jurisdictionFromRepo(repoName: string, plugin: string, frontmatter?: ParsedFrontmatter): string {
  const explicit = frontmatter?.jurisdiction?.toUpperCase();
  if (explicit === 'CN' || explicit === 'US' || explicit === 'INT') return explicit;
  if (repoName === 'claude-for-legal-ZH') return 'CN';
  if (INT_PLUGIN_HINTS.has(plugin)) return 'INT';
  return 'US';
}

async function walkDir(dir: string, targetName: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      results.push(...await walkDir(fullPath, targetName));
    } else if (entry.name === targetName) {
      results.push(fullPath);
    }
  }

  return results;
}

export class LocalSkillEngine {
  private promptCache = new Map<string, string>();

  async buildSystemPrompt(skillId: string): Promise<string> {
    const cached = this.promptCache.get(skillId);
    if (cached) return cached;

    const [prefix, plugin, skillName] = skillId.split(':');
    const repoName = prefix === 'cn' ? 'claude-for-legal-ZH' : 'claude-for-legal';
    const repoRoot = path.join(resolveReferencesDir(), repoName);
    const skillFiles = await walkDir(path.join(repoRoot, plugin), 'SKILL.md');

    for (const filePath of skillFiles) {
      const raw = await fs.readFile(filePath, 'utf-8');
      const { frontmatter, body } = parseFrontmatter(raw);
      const resolvedName = frontmatter.name || path.basename(path.dirname(filePath));
      const jurisdiction = jurisdictionFromRepo(repoName, plugin, frontmatter).toLowerCase();
      const candidateId = `${jurisdiction}:${plugin}:${resolvedName}`;
      if (candidateId === skillId) {
        this.promptCache.set(skillId, body);
        return body;
      }
    }

    throw new Error(`Local skill prompt not found: ${skillId}`);
  }
}
