import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Whitelist check — prevent path traversal
  if (!/^[a-z0-9_-]+$/.test(id)) {
    return NextResponse.json({ error: "invalid chassis id" }, { status: 400 });
  }

  const dataDir = join(process.cwd(), "data", "chassis");

  try {
    const [metaJson, svgText] = await Promise.all([
      readFile(join(dataDir, `${id}.json`), "utf-8"),
      readFile(join(dataDir, `${id}.svg`), "utf-8"),
    ]);

    const metadata = JSON.parse(metaJson);

    // Strip the outer <svg> wrapper so we can inline the content into our renderer's <svg>
    const svgInner = svgText
      .replace(/^[\s\S]*?<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "")
      .trim();

    return NextResponse.json({ metadata, svgInner });
  } catch (err) {
    return NextResponse.json(
      { error: `chassis '${id}' not found: ${err instanceof Error ? err.message : String(err)}` },
      { status: 404 },
    );
  }
}
