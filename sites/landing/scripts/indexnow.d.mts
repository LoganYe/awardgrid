// Types for indexnow.mjs (plain Node ESM, run without a build), so the landing package's tests typecheck against it.

export declare const HOST: "awardgrid.dowhiz.com";
export declare const ENDPOINT: string;
export declare const SITE_DIR: string;
export declare const USAGE: string;

export interface SiteConfig {
  host: string;
  paths: string[];
  key: string;
}

export interface Payload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

export interface Deps {
  fetch?: typeof globalThis.fetch;
  siteDir?: string;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  now?: () => Date;
}

export declare function findKey(publicDir: string): string;
export declare function readSiteConfig(siteDir?: string): SiteConfig;
export declare function pageUrls(paths: string[], host?: string): string[];
export declare function buildPayload(key: string, urlList: string[]): Payload;
export declare function main(argv: string[], deps?: Deps): Promise<number>;
