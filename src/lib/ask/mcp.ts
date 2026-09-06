/**
 * The remote, keyless MCP servers the ask lane connects to (ARCHITECTURE.md §6.3; verified against
 * vendor/travel-hacking-toolkit/.mcp.json). They are passed to the SDK via `mcpServers` together
 * with `strictMcpConfig: true` and `plugins[].skipMcpDiscovery: true`, so the plugin's own
 * .mcp.json (which also lists `liteapi` — needs a key — and the stdio `airbnb` server —
 * `npx … --ignore-robots-txt`) is never read.
 *
 * Hard-coded on purpose: src/ must not import from scripts/plugin-manifest.ts, and the set is a
 * security boundary — a toolkit update must not be able to add a server here.
 */
import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export const KEPT_MCP_SERVERS: Readonly<Record<string, McpHttpServerConfig>> = Object.freeze({
  skiplagged: { type: "http", url: "https://mcp.skiplagged.com/mcp" },
  kiwi: { type: "http", url: "https://mcp.kiwi.com" },
  trivago: { type: "http", url: "https://mcp.trivago.com/mcp" },
  ferryhopper: { type: "http", url: "https://mcp.ferryhopper.com/mcp" },
});

export const KEPT_MCP_SERVER_NAMES: readonly string[] = Object.freeze(
  Object.keys(KEPT_MCP_SERVERS),
);

/** Servers from the toolkit's .mcp.json that are deliberately NOT connected. */
export const DROPPED_MCP_SERVER_NAMES: readonly string[] = Object.freeze(["liteapi", "airbnb"]);

/** `mcp__<server>__<tool>` → `{ server, tool }`, or null when the name is not an MCP tool name. */
export function parseMcpToolName(toolName: string): { server: string; tool: string } | null {
  if (!toolName.startsWith("mcp__")) return null;
  const rest = toolName.slice("mcp__".length);
  const sep = rest.indexOf("__");
  if (sep <= 0) return null;
  const server = rest.slice(0, sep);
  const tool = rest.slice(sep + 2);
  if (tool.length === 0) return null;
  return { server, tool };
}

/** True only for tools of the four kept servers. */
export function isKeptMcpTool(toolName: string): boolean {
  const parsed = parseMcpToolName(toolName);
  return parsed !== null && Object.prototype.hasOwnProperty.call(KEPT_MCP_SERVERS, parsed.server);
}

/** A fresh, mutable copy for the SDK `mcpServers` option (the SDK may not expect a frozen object). */
export function mcpServersOption(): Record<string, McpHttpServerConfig> {
  const out: Record<string, McpHttpServerConfig> = {};
  for (const [name, cfg] of Object.entries(KEPT_MCP_SERVERS))
    out[name] = { type: cfg.type, url: cfg.url };
  return out;
}
