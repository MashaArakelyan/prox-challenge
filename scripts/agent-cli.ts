// Minimal CLI harness for the Lookup-mode vertical slice.
// Usage: npx tsx scripts/agent-cli.ts
// Reads questions from stdin (one per line). Ctrl-D to exit.
// Tool calls and their inputs are logged to stderr for iteration visibility.

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
config();
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, ToolUseBlock, ContentBlock } from "@anthropic-ai/sdk/resources/messages";
import { tools, dispatch } from "../lib/agent/tools/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const systemPrompt = readFileSync(join(ROOT, "prompts", "system.md"), "utf8");

const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ROUNDS = 8;

const client = new Anthropic();

async function runTurn(userMessage: string): Promise<void> {
  const messages: MessageParam[] = [{ role: "user", content: userMessage }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: systemPrompt,
      tools,
      messages,
    });

    // Collect text and tool-use blocks from this response
    const toolUseBlocks = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    const textBlocks = response.content.filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text");

    // Stream text output as it arrives
    if (textBlocks.length && response.stop_reason !== "tool_use") {
      for (const block of textBlocks) {
        process.stdout.write(block.text);
      }
      process.stdout.write("\n");
    }

    if (response.stop_reason === "end_turn" || !toolUseBlocks.length) {
      // If we ended via tool_use but no tool blocks (shouldn't happen), still emit text
      if (textBlocks.length && response.stop_reason === "tool_use") {
        for (const block of textBlocks) process.stdout.write(block.text);
        process.stdout.write("\n");
      }
      break;
    }

    // Add the assistant's full response (with tool_use blocks) to the conversation
    messages.push({ role: "assistant", content: response.content });

    // Dispatch each tool call and collect results
    const toolResults: MessageParam["content"] = [];
    for (const toolCall of toolUseBlocks) {
      process.stderr.write(
        `[tool] ${toolCall.name}(${JSON.stringify(toolCall.input, null, 0)})\n`,
      );
      const result = await dispatch(toolCall.name, toolCall.input);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: result,
      });
    }

    // Add tool results as a user message and continue the loop
    messages.push({ role: "user", content: toolResults });
  }
}

async function main(): Promise<void> {
  process.stdout.write(`OmniPro 220 Agent (${MODEL}) — type a question, Enter to send, Ctrl-D to quit.\n\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    const question = line.trim();
    if (!question) continue;

    process.stdout.write(`\n--- Q: ${question}\n\n`);
    try {
      await runTurn(question);
    } catch (err) {
      process.stderr.write(`[error] ${(err as Error).message}\n`);
    }
    process.stdout.write("\n");
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
