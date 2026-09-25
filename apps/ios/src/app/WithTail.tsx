/**
 * A sentence in the screen's language that ends with words from elsewhere — an engine, Keychain or Anthropic message,
 * which are English (T11, U-039). The tail gets its own `lang`, so VoiceOver reads each part in its own voice. On an
 * English screen, or without a tail, it is the sentence as it is.
 */
export function WithTail({ text, tail, tailLang }: { text: string; tail?: string | null; tailLang?: string }) {
  if (!tail || !tailLang || !text.endsWith(tail)) return <>{text}</>;
  return (
    <>
      {text.slice(0, text.length - tail.length)}
      <span lang={tailLang}>{tail}</span>
    </>
  );
}
