// AgentRegistry — load and index all headless agents from both reference repos
// Mirrors claw-code's PORTED_COMMANDS / ExecutionRegistry pattern

import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import type { AgentMeta } from './types.js';

// Default cron schedules by agent name pattern
const DEFAULT_CRON: Record<string, string> = {
  'renewal-watcher':   '0 9 * * 1',   // Monday 9am
  'docket-watcher':    '0 8 * * *',   // Daily 8am
  'reg-monitor':       '0 7 * * 1',   // Monday 7am
  'launch-radar':      '0 10 * * 1',  // Monday 10am
  'diligence-grid':    '0 9 * * 3',   // Wednesday 9am
};

const REPOS = [
  { dir: 'claude-for-legal',    jurisdiction: 'US' as const },
  { dir: 'claude-for-legal-ZH', jurisdiction: 'CN' as const },
];

export class AgentRegistry {
  private agents: Map<string, AgentMeta> = new Map();
  private initialized = false;

  // ── Singleton ──────────────────────────────────────────────────────────────

  private static instance: AgentRegistry;
  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  // ── Load from disk ─────────────────────────────────────────────────────────

  async init(referencesRoot: string): Promise<void> {
    if (this.initialized) return;
    this.agents.clear();

    for (const repo of REPOS) {
      const repoPath = path.join(referencesRoot, repo.dir);
      if (!fs.existsSync(repoPath)) continue;
      await this.scanRepo(repoPath, repo.jurisdiction);
    }

    this.initialized = true;
    console.log(`[AgentRegistry] loaded ${this.agents.size} agents`);
  }

  private async scanRepo(
    repoPath: string,
    jurisdiction: 'CN' | 'US' | 'INT',
  ): Promise<void> {
    // Agents live at: <repo>/<plugin>/agents/<name>.md
    const pluginDirs = fs.readdirSync(repoPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);

    for (const plugin of pluginDirs) {
      const agentsDir = path.join(repoPath, plugin, 'agents');
      if (!fs.existsSync(agentsDir)) continue;

      const files = fs.readdirSync(agentsDir)
        .filter(f => f.endsWith('.md'));

      for (const file of files) {
        const filePath = path.join(agentsDir, file);
        const meta = this.parseAgentFile(filePath, plugin, jurisdiction);
        if (meta) {
          this.agents.set(meta.id, meta);
        }
      }
    }
  }

  private parseAgentFile(
    filePath: string,
    plugin: string,
    jurisdiction: 'CN' | 'US' | 'INT',
  ): AgentMeta | null {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
      const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
      if (!match) return null;

      const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
      const body = match[2].trim();

      const name = String(frontmatter.name ?? path.basename(filePath, '.md'));
      const tools = Array.isArray(frontmatter.tools)
        ? (frontmatter.tools as string[])
        : [];
      const model = String(frontmatter.model ?? 'sonnet');
      const description = String(
        typeof frontmatter.description === 'object'
          ? JSON.stringify(frontmatter.description)
          : (frontmatter.description ?? ''),
      ).trim();

      const prefix = jurisdiction === 'CN' ? 'cn' : jurisdiction === 'US' ? 'us' : 'int';
      const id = `${prefix}:${plugin}:${name}`;

      return {
        id,
        name,
        plugin,
        jurisdiction,
        description,
        model,
        tools,
        defaultCron: DEFAULT_CRON[name] ?? '0 9 * * 1',
        instructionsRaw: body,
        filePath,
      };
    } catch (err) {
      console.warn(`[AgentRegistry] failed to parse ${filePath}:`, err);
      return null;
    }
  }

  // ── Query interface (mirrors claw-code ExecutionRegistry) ─────────────────

  getAll(): AgentMeta[] {
    return Array.from(this.agents.values());
  }

  getById(id: string): AgentMeta | undefined {
    return this.agents.get(id);
  }

  getByJurisdiction(jurisdiction: 'CN' | 'US' | 'INT'): AgentMeta[] {
    return this.getAll().filter(a => a.jurisdiction === jurisdiction);
  }

  // Resolve allowed tools list from agent's tool patterns
  resolveAllowedTools(agentMeta: AgentMeta): Set<string> {
    // Expand wildcard patterns to concrete tool names
    // For now, store the patterns — actual permission check done at execution time
    return new Set(agentMeta.tools);
  }

  isToolAllowed(toolName: string, allowedPatterns: Set<string>): boolean {
    for (const pattern of allowedPatterns) {
      if (pattern === toolName) return true;
      if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (toolName.startsWith(prefix)) return true;
      }
    }
    return false;
  }
}
