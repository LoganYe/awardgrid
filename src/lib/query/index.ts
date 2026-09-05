/** Public API of the NL → QueryObject parser (kickoff §4.1–4.2). */
export {
  Cabin,
  DEFAULT_CABINS,
  IATA,
  ISODate,
  MAX_SPAN_DAYS,
  QueryObject,
  QueryObjectLLM,
  SortBy,
  type FutureSortBy,
  type QueryObjectInput,
} from "@/lib/query/schema";
export { parseQuery, type ParseQueryOptions, type ParseQueryResult } from "@/lib/query/parse";
export {
  parseDeterministic,
  parseCabins,
  parseMaxMiles,
  parseSortBy,
  parseDirectOnly,
  type DeterministicResult,
  type MissingField,
  type Provenance,
} from "@/lib/query/deterministic";
export { parseDates, capRange, addDays, parseISODate, formatISODate, type DateRange } from "@/lib/query/dates";
export {
  DEFAULT_PLACES,
  buildPlaces,
  expandPlace,
  expandMentions,
  findPlaceMentions,
  resolveAlias,
  splitPlaces,
  type Places,
  type PlaceMention,
  type SplitPlaces,
} from "@/lib/query/places";
export {
  ParseError,
  PARSER_MODEL_DEFAULT,
  PARSER_MAX_TOKENS,
  buildSystemPrompt,
  parseWithLLM,
  resolveParserModel,
  type ParserClient,
  type ParserRequest,
  type ParserResponse,
  type LLMParseOptions,
  type LLMParseResult,
} from "@/lib/query/llm";
export { detectLanguage, hasCJK, type QueryLanguage } from "@/lib/query/language";
