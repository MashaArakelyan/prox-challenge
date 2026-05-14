import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { tools, dispatch } from "../../../lib/agent/tools/index.js";

const systemPrompt = readFileSync(join(process.cwd(), "prompts", "system.md"), "utf8");
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 10;

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { message?: string; history?: MessageParam[] };
  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  // BYO-key: prefer header sent by the browser; fall back to server env var for local dev.
  const apiKey = req.headers.get("X-Anthropic-Key") ?? process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey || !apiKey.startsWith("sk-ant-")) {
    return Response.json(
      { error: "API key required. Set your Anthropic API key in the UI." },
      { status: 401 },
    );
  }

  const geminiKey = req.headers.get("x-gemini-key") ?? process.env.GEMINI_API_KEY ?? "";

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();
  const history: MessageParam[] = Array.isArray(body.history) ? body.history : [];

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        await runAgentLoop(client, message, history, emit, geminiKey);
        emit({ type: "done" });
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

async function runAgentLoop(
  client: Anthropic,
  userMessage: string,
  history: MessageParam[],
  emit: (event: object) => void,
  geminiKey: string,
): Promise<void> {
  // Prepend conversation history so the agent knows the current diagnostic state
  const messages: MessageParam[] = [
    ...history,
    { role: "user", content: userMessage },
  ];
  const turnStart = messages.length - 1; // index of the new user message

  let finalContent: MessageParam["content"] | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const anthropicStream = client.messages.stream({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      tools,
      messages,
    });

    // Forward text deltas to client as they arrive
    anthropicStream.on("text", (text) => {
      emit({ type: "text_delta", text });
    });

    const msg = await anthropicStream.finalMessage();
    const toolUseBlocks = msg.content.filter((b) => b.type === "tool_use");

    if (msg.stop_reason === "end_turn" || toolUseBlocks.length === 0) {
      // Final response — capture content for history but do not push yet
      finalContent = msg.content;
      break;
    }

    messages.push({ role: "assistant", content: msg.content });

    const toolResults: MessageParam["content"] = [];
    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;

      emit({ type: "tool_call", name: block.name, input: block.input });
      const resultStr = await dispatch(block.name, block.input, { geminiKey });

      try {
        const result = JSON.parse(resultStr) as Record<string, unknown>;

        if (block.name === "surface_region" && result.found && result.imagePath) {
          const diagram = result.diagram as Record<string, unknown> | undefined;
          const allRegions = result.allRegions as Array<{
            number: number; label: string;
            annotationX: number; annotationY: number;
          }> | undefined;
          const annotations = (allRegions ?? []).slice(0, 7).map((r) => ({
            number: r.number,
            x: r.annotationX,
            y: r.annotationY,
            label: r.label,
          }));
          emit({
            type: "image",
            path: result.imagePath as string,
            caption: diagram?.caption ?? "",
            annotations: annotations.length > 0 ? annotations : undefined,
          });
        }

        if (block.name === "render_artifact" && result.accepted === true && result.spec) {
          emit({ type: "artifact", spec: result.spec });
        }
      } catch {
        // non-JSON result is fine — just pass it through
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: resultStr,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Emit the complete turn message exchange so the client can thread history
  // into the next request. Includes all new messages added this turn + final response.
  const newMessages: MessageParam[] = messages.slice(turnStart);
  if (finalContent) {
    newMessages.push({ role: "assistant", content: finalContent });
  }
  emit({ type: "turn_messages", messages: newMessages });
}
