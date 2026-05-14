export const runtime = 'nodejs';

export async function POST(req: Request) {
  const geminiKey = req.headers.get('x-gemini-key') ?? process.env.GEMINI_API_KEY ?? '';
  if (!geminiKey) {
    return new Response(JSON.stringify({ error: 'Missing Gemini API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let prompt: string;
  try {
    const body = await req.json() as { prompt?: unknown };
    prompt = body.prompt as string;
    if (!prompt || typeof prompt !== 'string') throw new Error('prompt must be a non-empty string');
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: 'Invalid request body', detail: (e as Error).message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const resp = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': geminiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      }
    );

    if (!resp.ok) {
      const errorText = await resp.text();
      return new Response(JSON.stringify({ error: 'Gemini API error', status: resp.status, detail: errorText }), {
        status: resp.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await resp.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType: string; data: string } }> } }> };
    const parts = data?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));

    if (!imagePart?.inlineData) {
      return new Response(JSON.stringify({ error: 'No image in Gemini response', detail: JSON.stringify(data).slice(0, 500) }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const dataUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
    return new Response(JSON.stringify({ url: dataUrl, mimeType: imagePart.inlineData.mimeType }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: unknown) {
    return new Response(JSON.stringify({ error: 'Server error', detail: (e as Error).message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
