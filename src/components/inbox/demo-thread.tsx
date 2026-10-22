"use client";
import { Thread } from "./thread";
import type { ThreadMessage } from "./types";

export function DemoThread({ messages }: { messages: ThreadMessage[] }) {
  return <Thread messages={messages} onRetry={() => undefined} retrying={null} />;
}
