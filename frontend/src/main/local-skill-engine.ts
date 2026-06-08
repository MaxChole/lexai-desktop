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
  cnSkillRef?: string;
  usSkillRef?: string;
}

interface LocalSkillDefinition {
  id: string;
  plugin: string;
  name: string;
  jurisdiction: string;
  body: string;
  cnSkillRef?: string;
  usSkillRef?: string;
}

function resolveReferencesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'references'),
    path.resolve(process.cwd(), '../references'),
  ];

  return candidates[0];
}

function resolveCrossSkillsDir(): string {
  return path.resolve(process.cwd(), 'skills');
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

    const cnSkillRefMatch = line.match(/^cn-skill-ref:\s*(.+)$/);
    if (cnSkillRefMatch) {
      frontmatter.cnSkillRef = cnSkillRefMatch[1].trim().replace(/^['"]|['"]$/g, '');
    }

    const usSkillRefMatch = line.match(/^us-skill-ref:\s*(.+)$/);
    if (usSkillRefMatch) {
      frontmatter.usSkillRef = usSkillRefMatch[1].trim().replace(/^['"]|['"]$/g, '');
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

  constructor(private readonly profileRootDir?: string) {}

  invalidatePrompt(skillId?: string): void {
    if (skillId) {
      this.promptCache.delete(skillId);
      return;
    }
    this.promptCache.clear();
  }

  async buildSystemPrompt(skillId: string): Promise<string> {
    const definition = await this.getSkillDefinition(skillId);
    const practiceProfile = await this.loadPracticeProfileForSkill(definition);
    const prompt = practiceProfile
      ? `${definition.body}\n\n---\n\n# Practice Profile\n\n${practiceProfile}`
      : definition.body;
    this.promptCache.set(skillId, prompt);
    return prompt;
  }

  async getSkillDefinition(skillId: string): Promise<LocalSkillDefinition> {
    const cached = this.promptCache.get(skillId);
    if (cached) {
      const [jurisdiction, plugin, name] = skillId.split(':');
      return {
        id: skillId,
        plugin,
        name,
        jurisdiction: jurisdiction.toUpperCase(),
        body: cached,
      };
    }

    const [prefix, plugin, skillName] = skillId.split(':');
    if (prefix === 'cross') {
      const crossRoot = resolveCrossSkillsDir();
      const skillFiles = await walkDir(path.join(crossRoot, plugin), 'SKILL.md');

      for (const filePath of skillFiles) {
        const raw = await fs.readFile(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(raw);
        const resolvedName = frontmatter.name || path.basename(path.dirname(filePath));
        const candidateId = `cross:${plugin}:${resolvedName}`;
        if (candidateId === skillId) {
          return {
            id: skillId,
            plugin,
            name: resolvedName,
            jurisdiction: 'CROSS',
            body,
            cnSkillRef: frontmatter.cnSkillRef,
            usSkillRef: frontmatter.usSkillRef,
          };
        }
      }

      throw new Error(`Local cross skill prompt not found: ${skillId}`);
    }

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
        return {
          id: skillId,
          plugin,
          name: resolvedName,
          jurisdiction: jurisdiction.toUpperCase(),
          body,
        };
      }
    }

    throw new Error(`Local skill prompt not found: ${skillId}`);
  }

  async buildCrossComparison(skillId: string, userMessage: string, cnContent: string, usContent: string): Promise<string> {
    const definition = await this.getSkillDefinition(skillId);
    return [
      `# ${definition.name}`,
      '',
      `> 对照任务：${userMessage}`,
      '',
      '## 使用说明',
      '- 以下内容按中国法与美国法分别展开，便于逐项对照。',
      '- 这是对照输出，不是融合结论。',
      '',
      '## 中国法视角',
      cnContent.trim(),
      '',
      '## 美国法视角',
      usContent.trim(),
      '',
      '## 对照提醒',
      '- 优先核对两法域结论是否冲突、适用门槛是否不同、还缺哪些事实。',
      '- 如任一部分出现 `[需验证]` 或 `[verify]`，请回到原始法条或判例逐项复核。',
    ].join('\n');
  }

  private async loadPracticeProfileForSkill(definition: LocalSkillDefinition): Promise<string | undefined> {
    if (definition.jurisdiction === 'CROSS') {
      return undefined;
    }
    const repoRoot = path.join(
      resolveReferencesDir(),
      definition.id.startsWith('cn:') ? 'claude-for-legal-ZH' : 'claude-for-legal',
    );
    return this.loadPracticeProfile(repoRoot, definition.plugin);
  }

  private async loadPracticeProfile(repoRoot: string, plugin: string): Promise<string | undefined> {
    const localProfilePath = this.profileRootDir
      ? path.join(this.profileRootDir, `${plugin}.md`)
      : undefined;

    if (localProfilePath) {
      try {
        const raw = await fs.readFile(localProfilePath, 'utf-8');
        if (raw.trim()) {
          return raw.trim();
        }
      } catch {
        // Fall through to the repository template.
      }
    }

    const practiceProfilePath = path.join(repoRoot, plugin, 'CLAUDE.md');

    try {
      const raw = await fs.readFile(practiceProfilePath, 'utf-8');
      return raw.trim();
    } catch {
      return undefined;
    }
  }

  async readLocalPracticeProfile(plugin: string): Promise<string> {
    if (!this.profileRootDir) return '';

    const filePath = path.join(this.profileRootDir, `${plugin}.md`);
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  async saveLocalPracticeProfile(plugin: string, content: string): Promise<void> {
    if (!this.profileRootDir) {
      throw new Error('Local profile directory is not configured');
    }

    await fs.mkdir(this.profileRootDir, { recursive: true });
    const filePath = path.join(this.profileRootDir, `${plugin}.md`);
    await fs.writeFile(filePath, content, 'utf-8');
    this.invalidatePrompt();
  }
}
