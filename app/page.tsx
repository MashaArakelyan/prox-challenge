"use client";

import React, { useState, useRef, useEffect, useCallback, type FormEvent } from "react";
import type { ArtifactSpec, Annotation } from "../lib/artifact-harness/types.js";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import ArtifactRenderer from "../lib/artifact-harness/renderer.js";
import AnnotatedImage from "../lib/artifact-harness/templates/annotated_image.js";
import ReactMarkdown from "react-markdown";
import ApiKeyModal from "./components/ApiKeyModal.js";
import KeyIndicator from "./components/KeyIndicator.js";

// Transforms "(p. 23)" / "(p. 7, table name)" inline spans into subtle citation chips
const CITATION_RE = /(\(p\.\s*\d+(?:[^)]*)??\))/g;

const mdComponents = {
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { children?: React.ReactNode }) => {
    const transformed = React.Children.map(children, (child) => {
      if (typeof child !== "string") return child;
      const parts = child.split(CITATION_RE);
      return parts.map((part, i) =>
        CITATION_RE.test(part) ? (
          <span key={i} className="text-xs text-zinc-500 font-mono bg-zinc-900 rounded px-1.5 py-0.5 ml-1 whitespace-nowrap">
            {part.slice(1, -1)}
          </span>
        ) : part
      );
    });
    CITATION_RE.lastIndex = 0;
    return <p {...props}>{transformed}</p>;
  },
};

interface ChatImage {
  path: string;
  caption: string;
  annotations?: Annotation[];
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
  artifact?: ArtifactSpec;
}

interface PersistedChat {
  messages: Message[];
  apiHistory: MessageParam[];
}

const EXAMPLES = [
  { q: "What's the duty cycle for MIG at 200A on 240V?", tag: "lookup" },
  { q: "Show me how duty cycle changes between 120V and 240V", tag: "chart" },
  { q: "Which socket does the TIG torch cable go into?", tag: "diagram" },
  { q: "My MIG weld has porosity — tiny holes in the bead", tag: "diagnose" },
  { q: "How do I set up the machine for stick welding 7018?", tag: "configure" },
];

const STORAGE_KEY_CHAT = "chat_history";
const STORAGE_KEY_API_KEY = "anthropic_api_key";
const MAX_HISTORY_TURNS = 20;

function loadChat(): PersistedChat | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CHAT);
    return raw ? (JSON.parse(raw) as PersistedChat) : null;
  } catch {
    return null;
  }
}

function saveChat(data: PersistedChat) {
  try {
    localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(data));
  } catch {
    // localStorage may be full — fail silently
  }
}

export default function Page() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [apiHistory, setApiHistory] = useState<MessageParam[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hydrate from localStorage once on mount
  useEffect(() => {
    const storedKey = localStorage.getItem(STORAGE_KEY_API_KEY);
    if (storedKey) {
      setApiKey(storedKey);
    } else {
      setShowModal(true);
    }
    const chat = loadChat();
    if (chat) {
      setMessages(chat.messages);
      setApiHistory(chat.apiHistory);
    }
    setHydrated(true);
  }, []);

  // Debounced persistence
  const scheduleSave = useCallback((msgs: Message[], history: MessageParam[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const cappedMsgs = msgs.slice(-MAX_HISTORY_TURNS * 2);
      const cappedHistory = history.slice(-MAX_HISTORY_TURNS * 2);
      saveChat({ messages: cappedMsgs, apiHistory: cappedHistory });
    }, 300);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const messagesRef = useRef(messages);
  const historyRef = useRef(apiHistory);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { historyRef.current = apiHistory; }, [apiHistory]);

  useEffect(() => {
    if (!hydrated) return;
    scheduleSave(messagesRef.current, historyRef.current);
  }, [messages, hydrated, scheduleSave]);

  useEffect(() => {
    if (!hydrated) return;
    scheduleSave(messagesRef.current, historyRef.current);
  }, [apiHistory, hydrated, scheduleSave]);

  function handleKey(key: string) {
    localStorage.setItem(STORAGE_KEY_API_KEY, key);
    setApiKey(key);
    setShowModal(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function handleChangeKey() {
    localStorage.removeItem(STORAGE_KEY_API_KEY);
    setApiKey(null);
    setShowModal(true);
  }

  function handleNewChat() {
    if (messages.length > 0 && !confirm("Start a new chat? This will clear the current conversation.")) return;
    setMessages([]);
    setApiHistory([]);
    localStorage.removeItem(STORAGE_KEY_CHAT);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isLoading || !apiKey) return;

    setInput("");
    setIsLoading(true);

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text: trimmed };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = { id: assistantId, role: "assistant", text: "", images: [] };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    let streamText = "";
    let streamImages: ChatImage[] = [];

    function patchAssistant(patch: Partial<Message>) {
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)));
    }

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Anthropic-Key": apiKey,
        },
        body: JSON.stringify({ message: trimmed, history: apiHistory }),
      });

      if (res.status === 401) {
        localStorage.removeItem(STORAGE_KEY_API_KEY);
        setApiKey(null);
        setShowModal(true);
        patchAssistant({ text: "API key is invalid or missing. Please enter a valid key." });
        setIsLoading(false);
        return;
      }

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
              const raw = ev.path as string;
              const path = raw.startsWith("data/images/")
                ? raw.replace("data/images/", "/api/images/")
                : `/api/images/${raw.split("/").pop() ?? raw}`;
              streamImages = [...streamImages, {
                path,
                caption: String(ev.caption ?? ""),
                annotations: Array.isArray(ev.annotations) ? ev.annotations as Annotation[] : undefined,
              }];
              patchAssistant({ images: streamImages });
            } else if (ev.type === "artifact") {
              patchAssistant({ artifact: ev.spec as ArtifactSpec });
            } else if (ev.type === "turn_messages") {
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

  const isDiagnose = apiHistory.some((m) => {
    if (m.role !== "assistant" || typeof m.content === "string") return false;
    return (m.content as Array<{ type: string; name?: string }>).some(
      (b) => b.type === "tool_use" && (b.name === "list_symptoms" || b.name === "diagnose_loop"),
    );
  });

  return (
    <>
      {showModal && <ApiKeyModal onKey={handleKey} />}
      <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
        {/* Header */}
        <header className="border-b border-zinc-800 shrink-0">
          <div className="max-w-3xl mx-auto w-full px-4 py-4 flex items-center gap-3">
            <div className="w-7 h-7 rounded flex items-center justify-center text-xs font-bold text-white bg-orange-600 shrink-0">
              V
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold leading-none">OmniPro 220 Agent</p>
                {isDiagnose && (
                  <span className="text-[10px] uppercase tracking-widest font-semibold text-orange-500 bg-orange-500/10 rounded px-1.5 py-0.5">
                    Diagnose
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-0.5">Vulcan multiprocess welder</p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {apiKey && <KeyIndicator onChangeKey={handleChangeKey} />}
              {messages.length > 0 && (
                <button
                  onClick={handleNewChat}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded hover:bg-zinc-800"
                >
                  New chat
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto w-full px-4 py-6 space-y-5">
            {messages.length === 0 && hydrated && (
              <EmptyState send={send} apiKey={apiKey} />
            )}
            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
            {isLoading && messages.at(-1)?.role === "user" && <TypingIndicator />}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Input */}
        <form onSubmit={handleSubmit} className="border-t border-zinc-800 shrink-0">
          <div className="max-w-3xl mx-auto w-full px-4 py-4">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={apiKey ? "Ask about the OmniPro 220…" : "Set your API key to start"}
                disabled={isLoading || !apiKey}
                autoFocus
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none focus:border-zinc-500 transition-colors disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim() || !apiKey}
                className="px-4 py-2.5 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
              >
                Send
              </button>
            </div>
          </div>
        </form>
      </div>
    </>
  );
}

function EmptyState({ send, apiKey }: { send: (t: string) => void; apiKey: string | null }) {
  return (
    <div className="space-y-4 pt-8">
      <p className="text-sm text-zinc-400">
        Try one of these — or ask anything about specs, setup, wiring, or troubleshooting.
      </p>
      <div className="space-y-1.5">
        {EXAMPLES.map(({ q, tag }) => (
          <button
            key={q}
            onClick={() => send(q)}
            disabled={!apiKey}
            className="block w-full text-left text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 rounded px-2 py-1.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="text-[9px] uppercase tracking-widest text-zinc-600 font-semibold mr-2">{tag}</span>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center text-xs font-bold text-white shrink-0">
        V
      </div>
      <div className="flex gap-1 items-center py-2">
        {[0, 150, 300].map((d) => (
          <span
            key={d}
            className="w-2 h-2 rounded-full bg-zinc-600 animate-bounce"
            style={{ animationDelay: `${d}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function ChatBubble({ msg }: { msg: Message }) {
  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-zinc-800 rounded-2xl rounded-br-md px-4 py-2.5 max-w-[85%] text-sm whitespace-pre-wrap">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-orange-600 flex items-center justify-center text-xs font-bold text-white shrink-0 mt-0.5">
        V
      </div>
      <div className="flex-1 min-w-0 space-y-3">
        {msg.text && (
          <div className="prose prose-invert prose-sm max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0">
            <ReactMarkdown components={mdComponents}>{msg.text}</ReactMarkdown>
          </div>
        )}
        {msg.images?.map((img, i) => (
          <div key={i} className="max-w-md">
            <AnnotatedImage
              src={img.path}
              caption={img.caption || undefined}
              annotations={img.annotations}
            />
          </div>
        ))}
        {msg.artifact && (
          <div className="rounded-lg border border-zinc-800 overflow-hidden bg-zinc-950/50">
            <div className="px-4 py-2.5 bg-zinc-900/80 border-b border-zinc-800 flex items-center gap-3">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-semibold">
                {msg.artifact.kind === "template"
                  ? msg.artifact.template.replace(/_/g, " ")
                  : msg.artifact.kind}
              </span>
              <span className="text-sm font-medium text-zinc-200">{msg.artifact.title}</span>
            </div>
            <div className="p-4">
              <ArtifactRenderer spec={msg.artifact} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
