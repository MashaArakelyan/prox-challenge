"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import type { ArtifactSpec } from "../lib/artifact-harness/types.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import ArtifactRenderer from "../lib/artifact-harness/renderer.js";

interface ChatImage {
  path: string;
  caption: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
  artifact?: ArtifactSpec;
}

const EXAMPLES = [
  "Show me how duty cycle changes between 120V and 240V",
  "Which socket does the TIG torch cable go into?",
  "Build me a duty cycle calculator",
  "My MIG weld on mild steel has porosity — tiny holes in the bead",
];

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  // Full Anthropic message exchange for multi-turn context (diagnose mode)
  const [apiHistory, setApiHistory] = useState<MessageParam[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactSpec | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    setInput("");
    setIsLoading(true);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: trimmed };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", text: "", images: [] };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    // Mutable accumulators — avoids stale closure bugs with rapid setState calls
    let streamText = "";
    let streamImages: ChatImage[] = [];

    function patchAssistant(patch: Partial<Message>) {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
    }

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history: apiHistory }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6)) as { type: string } & Record<string, unknown>;

            if (ev.type === "text_delta") {
              streamText += ev.text as string;
              patchAssistant({ text: streamText });
            } else if (ev.type === "image") {
              // Rewrite data/images/... → /api/images/...
              const raw = ev.path as string;
              const path = raw.startsWith("data/images/")
                ? raw.replace("data/images/", "/api/images/")
                : `/api/images/${raw.split("/").pop() ?? raw}`;
              streamImages = [...streamImages, { path, caption: String(ev.caption ?? "") }];
              patchAssistant({ images: streamImages });
            } else if (ev.type === "artifact") {
              const spec = ev.spec as ArtifactSpec;
              setActiveArtifact(spec);
              patchAssistant({ artifact: spec });
            } else if (ev.type === "turn_messages") {
              // Accumulate full API message exchange for multi-turn context (diagnose mode)
              setApiHistory((prev) => [...prev, ...(ev.messages as MessageParam[])]);
            }
          } catch {
            // malformed SSE line — skip
          }
        }
      }
    } catch (err) {
      patchAssistant({
        text: streamText || `Error: ${err instanceof Error ? err.message : "Request failed"}`,
      });
    }

    setIsLoading(false);
    inputRef.current?.focus();
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  // The panel shows whichever artifact arrived most recently
  const panelArtifact =
    activeArtifact ??
    [...messages].reverse().find((m) => m.artifact)?.artifact ??
    null;

  return (
    <div className="flex h-screen bg-zinc-950 text-zinc-100">
      {/* ── LEFT: Chat ─────────────────────────────────────────────────── */}
      <div className="flex flex-col w-[460px] min-w-[320px] border-r border-zinc-800 shrink-0">
        {/* Header */}
        <header className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
          <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold text-white bg-orange-600 shrink-0">
            V
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">OmniPro 220 Agent</p>
            <p className="text-xs text-zinc-500 mt-0.5">Vulcan multiprocess welder</p>
          </div>
        </header>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-5">
          {messages.length === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-400">
                Ask anything about the welder — specs, setup, troubleshooting, or wiring.
              </p>
              <div className="space-y-1.5">
                {EXAMPLES.map((q) => (
                  <button
                    key={q}
                    onClick={() => void send(q)}
                    className="block w-full text-left text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded px-2 py-1.5 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatBubble key={msg.id} msg={msg} />
          ))}

          {isLoading && messages.at(-1)?.role === "user" && (
            <div className="flex gap-1 py-1 px-1">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="px-4 py-4 border-t border-zinc-800 shrink-0"
        >
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about the OmniPro 220…"
              disabled={isLoading}
              autoFocus
              className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
            >
              Send
            </button>
          </div>
        </form>
      </div>

      {/* ── RIGHT: Artifact panel ───────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {panelArtifact ? (
          <>
            <header className="flex items-center gap-3 px-5 py-3.5 border-b border-zinc-800 shrink-0">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                {panelArtifact.kind === "template"
                  ? panelArtifact.template.replace(/_/g, " ")
                  : panelArtifact.kind}
              </span>
              <span className="text-sm font-medium text-zinc-200">{panelArtifact.title}</span>
            </header>
            <div className="flex-1 overflow-auto p-6">
              <ArtifactRenderer spec={panelArtifact} />
            </div>
          </>
        ) : (
          <EmptyArtifactPanel />
        )}
      </div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] bg-zinc-800 rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="text-sm text-zinc-100">{msg.text}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-[95%]">
      {msg.text && (
        <div className="text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap">
          {msg.text}
        </div>
      )}
      {msg.images?.map((img, i) => (
        <div key={i} className="rounded-lg overflow-hidden border border-zinc-800">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.path} alt={img.caption} className="w-full h-auto block" />
          {img.caption && (
            <p className="px-3 py-2 text-xs text-zinc-400 bg-zinc-900/80">{img.caption}</p>
          )}
        </div>
      ))}
      {msg.artifact && (
        <div className="text-xs text-zinc-600 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block" />
          Artifact rendered in the right panel
        </div>
      )}
    </div>
  );
}

function EmptyArtifactPanel() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-zinc-700">
      <svg
        width="48"
        height="48"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <path d="M3 9h18M9 21V9" />
      </svg>
      <div className="text-center">
        <p className="text-sm text-zinc-600">Artifact panel</p>
        <p className="text-xs text-zinc-700 mt-1">
          Charts, calculators, and diagrams appear here
        </p>
        <p className="text-xs text-zinc-800 mt-3">
          Try: &ldquo;Show me how duty cycle changes between 120V and 240V&rdquo;
        </p>
      </div>
    </div>
  );
}
