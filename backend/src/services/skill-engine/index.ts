import fs from 'fs/promises';
import path from 'path';
import YAML from 'yaml';
import type { SkillMeta, AgentMeta, Jurisdiction } from '../../types/shared.js';

const INT_PLUGIN_HINTS = new Set([
  'ai-governance-legal',
  'privacy-legal',
  'regulatory-legal',
]);

// ── Frontmatter parser ──

/** Clean description for safe JSON serialization: remove control chars, collapse whitespace */
function cleanDescription(raw: string): string {
  return raw
    .replace(/[\r\n\t]/g, ' ')
    .replace(/[\x00-\x1f\x7f]/g, '')  // remove other control chars
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  // Normalize CRLF to LF for consistent regex matching
  const normalized = raw.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: normalized };
  }
  const frontmatter = YAML.parse(match[1]) as Record<string, unknown>;
  const body = match[2];
  return { frontmatter, body };
}

// ── Path helpers ──

/**
 * Determine jurisdiction from repo path.
 * claude-for-legal → 'US' (with some 'INT' content)
 * claude-for-legal-ZH → 'CN'
 */
function jurisdictionFromRepo(
  repoName: string,
  plugin: string,
  frontmatter?: Record<string, unknown>,
): Jurisdiction {
  const explicitJurisdiction = typeof frontmatter?.jurisdiction === 'string'
    ? frontmatter.jurisdiction.toUpperCase()
    : undefined;

  if (explicitJurisdiction === 'CN' || explicitJurisdiction === 'US' || explicitJurisdiction === 'INT') {
    return explicitJurisdiction;
  }

  if (repoName === 'claude-for-legal-ZH') return 'CN';

  if (INT_PLUGIN_HINTS.has(plugin)) return 'INT';

  return 'US';
}

/**
 * Extract plugin name from path like:
 * references/claude-for-legal/commercial-legal/skills/review/SKILL.md
 * → plugin = "commercial-legal"
 */
function pluginFromPath(filePath: string, repoRoot: string): string {
  const relative = path.relative(repoRoot, filePath);
  const parts = relative.split(path.sep);
  // parts[0] = plugin directory (e.g. "commercial-legal")
  // Skip "external_plugins" prefix if present
  if (parts[0] === 'external_plugins') {
    return parts.slice(0, 3).join('/'); // e.g. "external_plugins/cocounsel-legal"
  }
  return parts[0];
}

// ── SkillRegistry ──

export class SkillRegistry {
  private skills: Map<string, SkillMeta> = new Map();
  private agents: Map<string, AgentMeta> = new Map();

  /**
   * Scan both reference repositories and load all SKILL.md + agent .md files.
   */
  async load(referencesDir: string): Promise<void> {
    const repos = ['claude-for-legal', 'claude-for-legal-ZH'];

    for (const repo of repos) {
      const repoRoot = path.join(referencesDir, repo);
      try {
        await fs.access(repoRoot);
      } catch {
        console.warn(`Reference repo not found: ${repoRoot}`);
        continue;
      }

      // Scan SKILL.md files
      const skillFiles = await this.walkDir(repoRoot, 'SKILL.md');
      for (const filePath of skillFiles) {
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(raw);
          const plugin = pluginFromPath(filePath, repoRoot);
          const name = (frontmatter.name as string) || path.basename(path.dirname(filePath));
          const jurisdiction = jurisdictionFromRepo(repo, plugin, frontmatter);
          const id = `${jurisdiction.toLowerCase()}:${plugin}:${name}`;
          const description = cleanDescription((frontmatter.description as string) || '');

          this.skills.set(id, {
            id,
            name,
            plugin,
            jurisdiction,
            description,
            argumentHint: frontmatter['argument-hint'] as string | undefined,
            userInvocable: frontmatter['user-invocable'] !== false,
            filePath,
            systemPromptRaw: body,
          });
        } catch (err) {
          console.warn(`Failed to parse ${filePath}:`, err);
        }
      }

      // Scan agent .md files
      const agentFiles = await this.walkAgentDir(repoRoot);
      for (const filePath of agentFiles) {
        try {
          const raw = await fs.readFile(filePath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(raw);
          const plugin = pluginFromPath(filePath, repoRoot);
          const name = (frontmatter.name as string) || path.basename(filePath, '.md');
          const jurisdiction = jurisdictionFromRepo(repo, plugin, frontmatter);
          const id = `${jurisdiction.toLowerCase()}:${plugin}:${name}`;

          this.agents.set(id, {
            id,
            name,
            plugin,
            jurisdiction,
            description: cleanDescription((frontmatter.description as string) || ''),
            model: (frontmatter.model as 'sonnet' | 'opus' | 'haiku') || 'sonnet',
            tools: (frontmatter.tools as string[]) || [],
            filePath,
            instructionsRaw: body,
          });
        } catch (err) {
          console.warn(`Failed to parse agent ${filePath}:`, err);
        }
      }
    }

    console.log(`SkillRegistry loaded: ${this.skills.size} skills, ${this.agents.size} agents`);
  }

  /**
   * Query skills by jurisdiction and userInvocable filter.
   */
  querySkills(jurisdiction?: Jurisdiction | 'ALL', userInvocable?: boolean): SkillMeta[] {
    const results: SkillMeta[] = [];
    for (const skill of this.skills.values()) {
      if (jurisdiction && jurisdiction !== 'ALL' && skill.jurisdiction !== jurisdiction) continue;
      if (userInvocable !== undefined && skill.userInvocable !== userInvocable) continue;
      results.push(skill);
    }
    return results.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Get a single skill by ID.
   */
  getSkill(skillId: string): SkillMeta | undefined {
    return this.skills.get(skillId);
  }

  /**
   * Query agents by jurisdiction.
   */
  queryAgents(jurisdiction?: Jurisdiction | 'ALL'): AgentMeta[] {
    const results: AgentMeta[] = [];
    for (const agent of this.agents.values()) {
      if (jurisdiction && jurisdiction !== 'ALL' && agent.jurisdiction !== jurisdiction) continue;
      results.push(agent);
    }
    return results.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Get a single agent by ID.
   */
  getAgent(agentId: string): AgentMeta | undefined {
    return this.agents.get(agentId);
  }

  // ── Private helpers ──

  /**
   * Recursively find all files matching `targetName` under `dir`.
   */
  private async walkDir(dir: string, targetName: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip hidden dirs and node_modules
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        results.push(...await this.walkDir(fullPath, targetName));
      } else if (entry.name === targetName) {
        results.push(fullPath);
      }
    }
    return results;
  }

  /**
   * Recursively find all .md files under `agents/` directories.
   */
  private async walkAgentDir(repoRoot: string): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(repoRoot, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(repoRoot, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const agentsDir = path.join(fullPath, 'agents');
        try {
          const stat = await fs.stat(agentsDir);
          if (stat.isDirectory()) {
            const files = await fs.readdir(agentsDir);
            for (const file of files) {
              if (file.endsWith('.md')) {
                results.push(path.join(agentsDir, file));
              }
            }
          }
        } catch {
          // No agents directory in this plugin — skip
        }
        // Also check sub-structures (e.g. external_plugins/cocounsel-legal/agents/)
        results.push(...await this.walkAgentDir(fullPath));
      }
    }
    return results;
  }
}

// ── SkillEngine ──

export class SkillEngine {
  private registry: SkillRegistry;

  constructor(registry: SkillRegistry) {
    this.registry = registry;
  }

  /**
   * Build the system prompt for a given skill.
   * Order: Skill body → Practice Profile (if provided) → User input (not cached)
   * For Prompt Caching, the skill body + profile should be marked as cacheable prefix.
   */
  buildSystemPrompt(skillId: string, practiceProfile?: string): string {
    const skill = this.registry.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    let prompt = skill.systemPromptRaw;

    if (practiceProfile) {
      prompt += `\n\n---\n\n# Practice Profile\n\n${practiceProfile}`;
    }

    return prompt;
  }

  /**
   * Build system prompt for an agent.
   */
  buildAgentPrompt(agentId: string): string {
    const agent = this.registry.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    return agent.instructionsRaw;
  }
}
