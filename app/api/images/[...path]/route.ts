import { readFileSync } from "node:fs";
import { join } from "node:path";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;
  // Prevent path traversal: only serve pngs from data/images/
  const filename = path.join("/").replace(/\.\./g, "").replace(/^\/+/, "");
  const filePath = join(process.cwd(), "data", "images", filename);

  try {
    const buffer = readFileSync(filePath);
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
