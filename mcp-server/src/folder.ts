// recognize_folder: every JPEG and PNG in one folder (not its subfolders), one detection per photo, in order, and the
// cards written to a new CSV and/or JSON file in that folder. Files are never overwritten; the folder must pass the same
// NEOSATOSHI_ALLOWED_DIRS check as image_path.

import { promises as fs } from "node:fs";
import path from "node:path";
import { expandHome, InputError, isInside, realAllowedDirs } from "./images.js";

type Obj = Record<string, any>;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);

export const CSV_COLUMNS = [
  "file", "card_index", "name", "tcg", "language", "set_name", "set_code", "number", "rarity", "cardmarket_id",
  "cardmarket_trend_eur", "cardmarket_avg30_eur", "tcgplayer_market_usd", "confidence", "graded", "season", "subset",
  "parallel", "request_id",
] as const;

/** The folder's real path, after the same NEOSATOSHI_ALLOWED_DIRS check as image_path. */
export async function resolveFolder(folder: string, allowedDirs: string[] | null): Promise<string> {
  if (typeof folder !== "string" || folder.trim() === "" || folder.includes("\0")) throw new InputError("folder is empty or invalid.");
  const requested = path.resolve(expandHome(folder.trim()));
  let dir: string;
  try {
    dir = await fs.realpath(requested);
    if (!(await fs.stat(dir)).isDirectory()) throw new Error("not a dir");
  } catch {
    throw new InputError(`Folder not found or not a folder: ${requested}`);
  }
  if (allowedDirs) {
    const allowed = await realAllowedDirs(allowedDirs);
    if (!allowed.some((d) => isInside(dir, d))) {
      throw new InputError(`Refused: ${requested} is outside the directories allowed by NEOSATOSHI_ALLOWED_DIRS.`);
    }
  }
  return dir;
}

/** The folder's real path and its image files (sorted by name), after the allowlist check. */
export async function listImages(folder: string, allowedDirs: string[] | null): Promise<{ dir: string; files: string[] }> {
  const dir = await resolveFolder(folder, allowedDirs);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => (e.isFile() || e.isSymbolicLink()) && IMAGE_EXT.has(path.extname(e.name).toLowerCase()) && !e.name.startsWith("."))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { dir, files };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** One CSV row per card. */
export function csvRows(file: string, resp: Obj): string[][] {
  const cards: Obj[] = Array.isArray(resp.cards) ? resp.cards : [];
  return cards.map((c, i) => {
    const set: Obj = c.set ?? {};
    const p: Obj | null = c.parallel ?? null;
    const g: Obj | null = c.graded ?? null;
    return [
      path.basename(file), String(c.card_index ?? i), c.full_name ?? c.name, c.tcg ?? "pokemon", c.language, set.name,
      set.ptcgo_code ?? set.code, set.number, c.rarity, c.cardmarket_id, c.prices?.cardmarket?.trend, c.prices?.cardmarket?.avg30,
      c.prices?.tcgplayer?.market, c.confidence, g ? [g.grader, g.grade].filter(Boolean).join(" ") : "", c.season, c.subset,
      p?.pick ? `${p.pick.name}${typeof p.pick.print_run === "number" ? ` /${p.pick.print_run}` : ""}` : "", resp.request_id,
    ].map(cell);
  });
}

export function toCsv(rows: string[][]): string {
  return [CSV_COLUMNS.join(","), ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}

/** Writes a new file next to the photos; never overwrites (adds -2, -3 ... on a clash). */
export async function writeNew(dir: string, base: string, ext: string, data: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const file = path.join(dir, `${base}${n === 1 ? "" : `-${n}`}${ext}`);
    try {
      await fs.writeFile(file, data, { flag: "wx" });
      return file;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw new InputError(`Could not write ${file}.`);
    }
  }
  throw new InputError("Could not find a free file name for the result.");
}

export function stamp(now = new Date()): string {
  const z = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${z(now.getMonth() + 1)}${z(now.getDate())}-${z(now.getHours())}${z(now.getMinutes())}${z(now.getSeconds())}`;
}
