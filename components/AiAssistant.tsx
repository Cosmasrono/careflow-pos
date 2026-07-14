"use client";

// Floating AI assistant. Available on every page for logged-in staff; asks
// /api/ai, which answers from a live snapshot of the clinic data.

import { useEffect, useRef, useState } from "react";
import { SparklesIcon, XIcon, SendIcon } from "lucide-react";
import { cn, Spinner } from "./ui";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "How is the clinic doing today?",
  "Which patients have been waiting longest?",
  "What medicines are running low?",
  "Summarize today's revenue",
];

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;

    const history = [...messages, { role: "user" as const, content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "The assistant is unavailable right now.");
        setMessages(history); // drop the empty assistant bubble
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        const current = answer;
        setMessages([...history, { role: "assistant", content: current }]);
      }
      if (answer.trim() === "") {
        setError("The assistant returned an empty answer. Try again.");
        setMessages(history);
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setError("Network error. Please try again.");
        setMessages(history);
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        className={cn(
          "fixed bottom-5 right-5 z-40 grid h-13 w-13 place-items-center rounded-full text-white shadow-lg shadow-teal-950/30 transition-all hover:scale-105 active:scale-95",
          open ? "bg-teal-950" : "bg-linear-to-br from-teal-500 to-teal-700",
        )}
      >
        {open ? <XIcon className="size-5" /> : <SparklesIcon className="size-5" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-21 right-5 z-40 flex h-[min(34rem,calc(100dvh-8rem))] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-teal-950/10 bg-white shadow-2xl shadow-teal-950/25">
          <header className="flex items-center gap-2.5 bg-linear-to-r from-teal-950 to-teal-900 px-4 py-3 text-white">
            <SparklesIcon className="size-4 text-teal-300" />
            <div>
              <p className="text-sm font-semibold leading-tight">CareFlow Assistant</p>
              <p className="text-[11px] text-teal-300/80">
                Answers from live clinic data
              </p>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.length === 0 && (
              <div className="space-y-2 pt-2">
                <p className="px-1 text-xs text-zinc-400">
                  Ask about patients, queues, revenue or stock:
                </p>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => ask(s)}
                    className="block w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-left text-sm text-zinc-600 transition-colors hover:border-teal-600/30 hover:bg-teal-50 hover:text-teal-900"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                  m.role === "user"
                    ? "ml-auto rounded-br-md bg-teal-700 text-white"
                    : "mr-auto rounded-bl-md bg-zinc-100 text-zinc-800",
                )}
              >
                {m.content === "" && m.role === "assistant" ? (
                  <Spinner className="my-1 text-teal-700" />
                ) : (
                  m.content
                )}
              </div>
            ))}

            {error && (
              <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-600/15">
                {error}
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="flex items-center gap-2 border-t border-zinc-100 p-2.5"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the assistant…"
              className="h-10 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20"
            />
            <button
              type="submit"
              disabled={busy || input.trim() === ""}
              aria-label="Send"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-700 text-white transition-colors hover:bg-teal-800 disabled:opacity-40"
            >
              {busy ? <Spinner /> : <SendIcon className="size-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}
