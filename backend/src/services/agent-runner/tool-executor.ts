// ToolExecutor — executes tools requested by the agent LLM
// Agents in claude-for-legal use: Read, Write, mcp__*, WebSearch etc.
// We implement the safe subset here; MCP tools are proxied via HTTP.

import fs from 'fs';
import path from 'path';
import type { ToolResult } from './types.js';

export class ToolExecutor {
  async execute(toolName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const toolCallId = `tool_${Date.now()}`;
    try {
      const output = await this.dispatch(toolName, input);
      return { toolCallId, toolName, output, isError: false };
    } catch (err) {
      return {
        toolCallId,
        toolName,
        output: err instanceof Error ? err.message : String(err),
        isError: true,
      };
    }
  }

  private async dispatch(toolName: string, input: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case 'Read':      return this.read(input);
      case 'Write':     return this.write(input);
      case 'WebSearch': return this.webSearch(input);
      default:
        if (toolName.startsWith('mcp__')) return this.mcpProxy(toolName, input);
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  private read(input: Record<string, unknown>): string {
    const filePath = String(input.file_path ?? '');
    if (!filePath) throw new Error('file_path is required');

    // Security: only allow reading within userData or references dirs
    const allowed = [
      process.env.USER_DATA_DIR ?? '',
      process.env.REFERENCES_DIR ?? '',
    ].filter(Boolean);

    const isAllowed = allowed.some(dir => filePath.startsWith(dir));
    if (!isAllowed) throw new Error(`Read outside allowed paths: ${filePath}`);

    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    const limit = Number(input.limit ?? 2000);
    const lines = content.split('\n');
    return lines.slice(0, limit).join('\n');
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  private write(input: Record<string, unknown>): string {
    const filePath = String(input.file_path ?? '');
    const content = String(input.content ?? '');
    if (!filePath) throw new Error('file_path is required');

    // Security: only allow writes within userData dir
    const userDataDir = process.env.USER_DATA_DIR ?? '';
    if (!userDataDir || !filePath.startsWith(userDataDir)) {
      throw new Error(`Write outside userData not allowed: ${filePath}`);
    }

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return `Written ${content.length} bytes to ${filePath}`;
  }

  // ── WebSearch (stub — replace with real search provider) ──────────────────

  private async webSearch(input: Record<string, unknown>): Promise<string> {
    const query = String(input.query ?? '');
    // TODO: integrate with Brave Search API or similar
    return `[WebSearch stub] Query received: "${query}". Connect a search provider in ToolExecutor.webSearch().`;
  }

  // ── MCP proxy — forward to configured MCP servers via HTTP ────────────────
  // Agents reference tools like mcp__ironclad__*, mcp__*__slack_send_message
  // MCP servers run as separate processes; we proxy calls via their HTTP port.

  private async mcpProxy(toolName: string, input: Record<string, unknown>): Promise<string> {
    // toolName format: mcp__<server>__<method>
    const parts = toolName.replace('mcp__', '').split('__');
    const serverName = parts[0];
    const methodName = parts.slice(1).join('__');

    const mcpBaseUrl = process.env[`MCP_${serverName.toUpperCase()}_URL`];
    if (!mcpBaseUrl) {
      return `[MCP] Server "${serverName}" not configured. Set MCP_${serverName.toUpperCase()}_URL env var.`;
    }

    const response = await fetch(`${mcpBaseUrl}/tools/${methodName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw new Error(`MCP ${serverName}/${methodName} returned ${response.status}`);
    }

    const result = await response.json() as { result?: unknown };
    return typeof result.result === 'string'
      ? result.result
      : JSON.stringify(result.result ?? result);
  }
}
