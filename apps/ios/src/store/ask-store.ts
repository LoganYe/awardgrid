/**
 * ask.json: the one Ask conversation this device keeps, beside the other snapshots in the Data directory.
 *
 * It is its own file, not part of cache.json, because different actions clear the two (design §6.7). "Clear
 * cached results" removes cache.json only, and "New conversation" removes ask.json only. Neither touches
 * quota.json, watches.json or either Keychain item.
 *
 * The shape and the version are core's (packages/core/src/lib/ask/conversation.ts, serializeConversation and
 * parseConversation). Reading is tolerant. A missing file, one cut short, hand-edited, from another version, or a
 * read that fails is simply no conversation. A write or remove that fails rejects, and the caller decides what
 * that costs. AskService logs it and carries on, because a failed save must not end a question that is running.
 */
import { parseConversation, serializeConversation, type Conversation } from "@awardgrid/core/ask/conversation";
import { capacitorFiles, type FileStore } from "./persistence";

export const ASK_FILE = "ask.json";

export class AskStore {
  readonly #files: FileStore;

  constructor(files: FileStore = capacitorFiles) {
    this.#files = files;
  }

  /** The saved conversation, or null. Never throws. */
  async read(): Promise<Conversation | null> {
    try {
      return parseConversation(await this.#files.read(ASK_FILE));
    } catch {
      return null;
    }
  }

  async write(conversation: Conversation): Promise<void> {
    await this.#files.write(ASK_FILE, serializeConversation(conversation));
  }

  /** Remove ask.json and nothing else. */
  async remove(): Promise<void> {
    await this.#files.remove(ASK_FILE);
  }
}
