import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { tools, dispatch } from "../../../lib/agent/tools/index.js";

const systemPrompt = readFileSync(join(process.cwd(), "prompts", "system.md"), "utf8");
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 8;

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { message?: string };
  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        await runAgentLoop(client, message, emit);
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
  emit: (event: object) => void,
): Promise<void> {
  const messages: MessageParam[] = [{ role: "user", content: userMessage }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const anthropicStream = client.messages.stream({
      model: MODEL,
      max_tokens: 2048,
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
    if (msg.stop_reason === "end_turn" || toolUseBlocks.length === 0) break;

    messages.push({ role: "assistant", content: msg.content });

    const toolResults: MessageParam["content"] = [];
    for (const block of toolUseBlocks) {
      if (block.type !== "tool_use") continue;

      emit({ type: "tool_call", name: block.name, input: block.input });
      const resultStr = dispatch(block.name, block.input);

      try {
        const result = JSON.parse(resultStr) as Record<string, unknown>;

        if (block.name === "surface_region" && result.found && result.imagePath) {
          const diagram = result.diagram as Record<string, unknown> | undefined;
          emit({
            type: "image",
            path: result.imagePath as string,
            caption: diagram?.caption ?? "",
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
}
