/**
 * LLM fallback parser (kickoff §4.2 "LLM call"): one `messages.parse` call with strict
 * structured output = QueryObjectLLM, system prompt embedding today's date, the places seed
 * (so output is IATA-only), the cabin/sort rules, the 92-day cap and the deterministic hints.
 *
 * The client is injected through the tiny `ParserClient` interface so tests use a fake and
 * never touch the network. No keys are handled here: the real client owns its own key.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { DEFAULT_PLACES, type Places } from "@/lib/query/places";
import { DEFAULT_CABINS, MAX_SPAN_DAYS, QueryObjectLLM, type QueryObjectInput } from "@/lib/query/schema";
import { SEATS_SOURCES } from "@/lib/seatsaero/types";

/** Default parser model (kickoff §2/§12: cheapest current model passing the fixture suite). */
export const PARSER_MODEL_DEFAULT = "claude-haiku-4-5-20251001";
export const PARSER_MAX_TOKENS = 1024;
export const LLM_RETRIES = 1;

export function resolveParserModel(env: Record<string, string | undefined> = process.env): string {
  const v = env.AWARDGRID_PARSER_MODEL?.trim();
  return v && v.length > 0 ? v : PARSER_MODEL_DEFAULT;
}

/** User-facing parse failure. `missing` lists fields the UI can ask for when known. */
export class ParseError extends Error {
  readonly missing: string[];
  constructor(message: string, opts: { missing?: string[]; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "ParseError";
    this.missing = opts.missing ?? [];
  }
}

/** The auto-parseable output format for QueryObjectLLM (what zodOutputFormat returns). */
export type QueryOutputFormat = ReturnType<typeof zodOutputFormat<typeof QueryObjectLLM>>;

/** The request shape we send; a structural subset of Anthropic's MessageCreateParamsNonStreaming. */
export type ParserRequest = Anthropic.Messages.MessageCreateParamsNonStreaming & {
  output_config: { format: QueryOutputFormat };
};

/** What we read back; a structural subset of ParsedMessage<QueryObjectLLM>. */
export interface ParserResponse {
  parsed_output: QueryObjectLLM | null;
  stop_reason: Anthropic.Messages.StopReason | null;
}

/** Injectable client: the real `Anthropic` instance satisfies this; tests pass a fake. */
export interface ParserClient {
  messages: {
    parse(params: ParserRequest): Promise<ParserResponse>;
  };
}

export interface LLMParseOptions {
  today: string;
  partial: Partial<QueryObjectInput>;
  client: ParserClient;
  model?: string;
  places?: Places;
}

export interface LLMParseResult {
  result: QueryObjectLLM;
  /** 1 = first try succeeded, 2 = the single retry did */
  attempts: number;
  model: string;
}

function seedText(places: Places): string {
  const cities = Object.entries(places.cities)
    .map(([metro, airports]) => `${metro}: ${airports.join(",")}`)
    .join("\n");
  const aliases = Object.entries(places.aliases)
    .map(([alias, code]) => `${alias}=${code}`)
    .join("; ");
  return `Metro/city codes and their airports (always expand a metro to ALL its airports, in this order):\n${cities}\n\nAliases (any language) → code:\n${aliases}`;
}

/** Exported for tests / prompt review. Deterministic for a given (today, partial, places). */
export function buildSystemPrompt(today: string, partial: Partial<QueryObjectInput>, places: Places = DEFAULT_PLACES): string {
  const known = { ...partial };
  delete known.raw_text;
  return [
    "You convert an award-flight search request (Chinese or English) into a strict JSON object.",
    `Today is ${today} (ISO, treat as the user's local date). All dates you output must be on or after today.`,
    "",
    "Rules:",
    "- origins/destinations: 3-letter upper-case IATA AIRPORT codes only, expanded from cities using the seed below. Keep the order the user mentioned them.",
    "- Text before a 'to' marker (到/至/飞/去/往/→/to) lists origins; text after it lists destinations. 'from X' marks origins.",
    `- date_from/date_to are inclusive YYYY-MM-DD. Span must not exceed ${MAX_SPAN_DAYS} days; if the user asks for more, keep date_from and shorten date_to.`,
    "- Relative windows: 未来一个月/next month/next 30 days = today..today+30; 未来两周/next two weeks = today+14; a bare month = the next occurrence of that whole month (this month → today..end of month).",
    "- Holidays: 国庆 = Oct 1–7; 春节 = the Chinese New Year week; Thanksgiving = the US Thursday and the 4 days after; 圣诞/Christmas = Dec 20–31; Golden Week (Japan) = Apr 29–May 5. Use the next occurrence.",
    `- cabins: 头等/first → "F"; 商务/business → "J"; 超经/premium economy → "W"; 经济/economy → "Y". Several may be listed. When the user says nothing about cabin, use ${JSON.stringify(DEFAULT_CABINS)}.`,
    "- sort_by: 最便宜/cheapest → miles_asc (also the default); 税费最低/lowest fees → fees_asc; 座位最多/most seats → seats_desc; 最早/earliest → date_asc.",
    "- direct_only: true only for 直飞/nonstop/direct. max_miles: integer miles ceiling (8万 = 80000, 80k = 80000) or null.",
    `- programs: seats.aero source codes only (${SEATS_SOURCES.join(", ")}) or null when none mentioned.`,
    "",
    "Already known from the deterministic parser (keep these values unless the text clearly contradicts them; fill only what is missing, but return the COMPLETE object):",
    JSON.stringify(known),
    "",
    seedText(places),
  ].join("\n");
}

function isSchemaFailure(err: unknown): boolean {
  // The SDK raises a plain AnthropicError (not an APIError) when the structured output does not
  // validate. API/transport errors are not retried here — the SDK already retries those.
  return err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError);
}

/**
 * Ask the model for the full QueryObjectLLM. Exactly ONE retry on schema failure, refusal or
 * max_tokens; then ParseError. Returns the raw LLM object — parse.ts applies caps and merges.
 */
export async function parseWithLLM(text: string, opts: LLMParseOptions): Promise<LLMParseResult> {
  const model = opts.model ?? resolveParserModel();
  const places = opts.places ?? DEFAULT_PLACES;
  const params: ParserRequest = {
    model,
    max_tokens: PARSER_MAX_TOKENS,
    system: buildSystemPrompt(opts.today, opts.partial, places),
    messages: [{ role: "user", content: text }],
    output_config: { format: zodOutputFormat(QueryObjectLLM) },
  };

  let lastReason = "unknown";
  let cause: unknown;
  for (let attempt = 1; attempt <= LLM_RETRIES + 1; attempt++) {
    let msg: ParserResponse;
    try {
      msg = await opts.client.messages.parse(params);
    } catch (err) {
      if (isSchemaFailure(err)) {
        lastReason = "the model's answer did not match the expected shape";
        cause = err;
        continue;
      }
      throw new ParseError("The query parser could not reach the language model. Please try again.", { cause: err });
    }
    if (msg.stop_reason === "refusal") {
      lastReason = "the model declined to answer";
      continue;
    }
    if (msg.stop_reason === "max_tokens") {
      lastReason = "the model's answer was cut off";
      continue;
    }
    // Re-validate: a fake client (or a future SDK) might hand back an unvalidated object.
    const checked = QueryObjectLLM.safeParse(msg.parsed_output);
    if (!checked.success) {
      lastReason = "the model's answer did not match the expected shape";
      cause = checked.error;
      continue;
    }
    return { result: checked.data, attempts: attempt, model };
  }
  throw new ParseError(
    `Could not understand the query after ${LLM_RETRIES + 1} attempts (${lastReason}). Try naming the cities, dates and cabin explicitly, e.g. "HKG to SEA, next month, business".`,
    { cause },
  );
}
