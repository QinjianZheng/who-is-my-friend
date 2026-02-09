import { NextResponse } from "next/server";
import { readdir, readFile } from "fs/promises";
import path from "path";

export async function GET() {
  const gamesDir = path.join(process.cwd(), "data", "games");
  try {
    const files = await readdir(gamesDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));
    const games = await Promise.all(
      jsonFiles.map(async (file) => {
        const raw = await readFile(path.join(gamesDir, file), "utf8");
        return JSON.parse(raw);
      })
    );
    return NextResponse.json(games);
  } catch {
    return NextResponse.json([]);
  }
}
