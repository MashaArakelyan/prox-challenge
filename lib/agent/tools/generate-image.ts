import type { Tool } from "@anthropic-ai/sdk/resources/messages";

export interface ToolContext {
  geminiKey?: string;
}

export const definition: Tool = {
  name: "generate_image",
  description:
    "Generate an AI illustration via Gemini 2.5 Flash Image. Use ONLY when no polished " +
    "code-rendered SVG covers the visual — e.g., internal mechanisms, defect reference photos, " +
    "isometric scenes. Do NOT use for socket/polarity/connection diagrams — those use code " +
    "generation with get_chassis_metadata. " +
    "IMPORTANT: The image is automatically displayed to the user as soon as this tool returns. " +
    "Do NOT call render_artifact after this tool — the image is already showing. " +
    "Just describe what the diagram shows in your text response. " +
    "Returns { success: true } on success or { error } on failure.",
  input_schema: {
    type: "object" as const,
    properties: {
      prompt: {
        type: "string",
        description:
          "Detailed image generation prompt. Specify style (technical line drawing, clean schematic, " +
          "isometric illustration), which parts to label, background (almost always white), and use " +
          "welder-domain terminology precisely.",
      },
    },
    required: ["prompt"],
  },
};

export async function handle(
  input: { prompt: string },
  ctx?: ToolContext,
): Promise<string> {
  console.log(`[generate-image] called, prompt length=${input.prompt?.length ?? 0}`);

  const keySource = ctx?.geminiKey ? "ctx" : process.env.GEMINI_API_KEY ? "env" : "none";
  const geminiKey = ctx?.geminiKey ?? process.env.GEMINI_API_KEY ?? "";
  console.log(`[generate-image] key source=${keySource}, has key=${!!geminiKey}`);

  if (!geminiKey) {
    console.error("[generate-image] no key available — returning error");
    return JSON.stringify({ error: "No Gemini API key — user must add one in settings to enable image generation." });
  }

  try {
    console.log("[generate-image] calling Gemini API...");
    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: input.prompt }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      },
    );

    console.log(`[generate-image] Gemini status=${resp.status}`);

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`[generate-image] Gemini error: ${errorText.slice(0, 300)}`);
      return JSON.stringify({ error: `Gemini API error ${resp.status}: ${errorText.slice(0, 200)}` });
    }

    const data = await resp.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> } }>;
    };
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart?.inlineData) {
      console.error(`[generate-image] no image part in response. candidates: ${JSON.stringify(data?.candidates).slice(0, 300)}`);
      return JSON.stringify({ error: "No image returned by Gemini" });
    }

    const dataUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    console.log(`[generate-image] success, data URL length=${dataUrl.length}`);
    return JSON.stringify({ url: dataUrl });
  } catch (e: unknown) {
    console.error("[generate-image] threw:", e);
    return JSON.stringify({ error: `Image generation failed: ${(e as Error).message}` });
  }
}
