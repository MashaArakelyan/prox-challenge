import { NextRequest, NextResponse } from "next/server";

const FAL_ENDPOINT = "https://fal.run/fal-ai/recraft-v3";

const cache = new Map<string, string>();

function promptHash(prompt: string): string {
  let h = 0;
  for (let i = 0; i < prompt.length; i++) {
    h = ((h << 5) - h) + prompt.charCodeAt(i);
    h |= 0;
  }
  return h.toString(36);
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "FAL_API_KEY not configured" }, { status: 500 });
  }

  let body: { prompt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const prompt = body.prompt?.trim();
  if (!prompt || prompt.length < 20) {
    return NextResponse.json({ error: "prompt required, min 20 chars" }, { status: 400 });
  }

  const cacheKey = promptHash(prompt);
  if (cache.has(cacheKey)) {
    return NextResponse.json({ url: cache.get(cacheKey)!, cached: true });
  }

  try {
    const falRes = await fetch(FAL_ENDPOINT, {
      method: "POST",
      headers: {
        "Authorization": `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        image_size: "landscape_4_3",
        style: "digital_illustration/hand_drawn",
      }),
    });

    if (!falRes.ok) {
      const errText = await falRes.text();
      return NextResponse.json(
        { error: `recraft error (${falRes.status}): ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const data = await falRes.json() as {
      images?: Array<{ url: string }>;
      image?: { url: string };
    };
    const url = data.images?.[0]?.url ?? data.image?.url;
    if (!url) {
      return NextResponse.json(
        { error: `no image URL in response: ${JSON.stringify(data).slice(0, 200)}` },
        { status: 502 },
      );
    }

    cache.set(cacheKey, url);
    return NextResponse.json({ url, cached: false });
  } catch (err) {
    return NextResponse.json(
      { error: `generation failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }
}
