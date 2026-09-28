// Types for verify-live.mjs (plain Node ESM, run without a build), so the landing package's tests typecheck against it.
import type { Deps, SiteConfig } from "./indexnow.mjs";

export { HOST } from "./indexnow.mjs";
export declare const WORKERS_DEV: string;
export declare const WORKERS_DEV_PATHS: string[];
export declare const WEB_APP_PATHS: string[];
export declare const NOINDEX_PATHS: Set<string>;
export declare const REQUEST_HEADERS: Readonly<Record<"user-agent" | "accept" | "accept-language" | "cache-control", string>>;
export declare const USAGE: string;

export type Level = "info" | "pass" | "warn" | "fail";
export type Mode = "after" | "before";
export type ProbeKind = "home" | "page" | "workers-dev" | "web-app" | "root-file" | "https-redirect";
/** "unknown" for a 5xx: Cloudflare's own error page. */
export type ServedBy = "worker" | "web-app" | "unknown";

export interface Site extends SiteConfig {
  robotsTxt: Buffer;
  workersDev?: string;
}

export interface Probe {
  kind: ProbeKind;
  path: string;
  url: string;
  file?: string;
}

export interface Check {
  id: string;
  level: Level;
  detail: string;
  /** Before a deploy: what the check expects after it, when that differs from now. */
  after_deploy?: string;
}

export interface Fetched {
  status: number;
  headers: Record<string, string>;
  bytes: Buffer;
  text: string;
}

export interface Context {
  mode: Mode;
  expectHttpsRedirect: boolean;
  host: string;
  paths: string[];
  key: string;
  robotsTxt: Buffer;
}

export interface Result {
  url: string;
  kind: ProbeKind;
  path: string;
  http_status: number | null;
  served_by: ServedBy | null;
  content_type?: string | null;
  location?: string | null;
  strict_transport_security?: string | null;
  x_robots_tag?: string | null;
  beacons?: number | null;
  other_scripts?: number | null;
  comments?: number | null;
  canonical?: string[] | null;
  meta_robots?: string[] | null;
  level: Level;
  checks: Check[];
}

export interface Report {
  tool: string;
  mode: "after-deploy" | "before-deploy";
  expect_https_redirect: boolean;
  host: string;
  workers_dev: string;
  checked_at: string;
  request_headers: Record<string, string>;
  ok: boolean;
  counts: Record<Level, number>;
  results: Result[];
}

export interface PageAnalysis {
  comments: number;
  beacons: number;
  ldJson: string[];
  otherScripts: string[];
  inline: string[];
  canonical: string[];
  metaRobots: string[];
}

export declare function attributes(text: string): Map<string, string>;
export declare function isBeacon(attrs: Map<string, string>): boolean;
export declare function classifyScripts(html: string): { ldJson: string[]; beacons: string[]; other: string[] };
export declare function inlineCode(html: string): string[];
export declare function countComments(html: string): number;
export declare function isNoindex(value: string): boolean;
export declare function metaRobots(html: string): string[];
export declare function canonicalLinks(html: string): string[];
export declare function analyzeHtml(html: string): PageAnalysis;
export declare function servedBy(headers: Record<string, string>, status?: number): ServedBy;
export declare function jsonTargetProblem(file: string): string | null;
export declare function sitemapLocs(xml: string): string[];
export declare function loadSite(siteDir?: string): Site;
export declare function rootFiles(key: string): { path: string; file: string }[];
export declare function planProbes(site: Site): Probe[];
export declare function evaluate(probe: Probe, res: Fetched | { error: string }, ctx: Context): Result;
export declare function request(url: string, fetchImpl: typeof globalThis.fetch, timeoutMs?: number): Promise<Fetched | { error: string }>;
export declare function verifyLive(options: {
  site: Site;
  mode?: Mode;
  expectHttpsRedirect?: boolean;
  fetch: typeof globalThis.fetch;
  now?: () => Date;
}): Promise<Report>;
export declare function formatReport(report: Report): string;
export declare function main(argv: string[], deps?: Deps): Promise<number>;
