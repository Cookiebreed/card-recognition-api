// Image input handling with the safety checks the server promises:
// regular files only, symlinks resolved, JPEG or PNG by magic bytes, 12 MB cap,
// optional directory allowlist (NEOSATOSHI_ALLOWED_DIRS). Nothing here touches the network.

import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_IMAGE_BYTES } from "./constants.js";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);
const MAX_MB = MAX_IMAGE_BYTES / (1024 * 1024);

export type ImageKind = "jpeg" | "png";

/** Detects JPEG or PNG from the first bytes. Returns null for anything else. */
export function sniffImageType(buf: Uint8Array): ImageKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= png.length && png.every((b, i) => buf[i] === b)) return "png";
  return null;
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * Parses NEOSATOSHI_ALLOWED_DIRS (entries separated by the platform path delimiter,
 * ":" on macOS and Linux, ";" on Windows). Returns null when the variable is unset or empty,
 * which means no directory restriction.
 */
export function parseAllowedDirs(raw: string | undefined): string[] | null {
  if (raw === undefined || raw.trim() === "") return null;
  return raw
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => path.resolve(expandHome(s)));
}

/** Resolves allowlist entries to real paths. Entries that do not exist are dropped. */
async function realAllowedDirs(dirs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const d of dirs) {
    try {
      const real = await fs.realpath(d);
      if ((await fs.stat(real)).isDirectory()) out.push(real);
    } catch {
      // A missing entry grants nothing.
    }
  }
  return out;
}

export function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export interface ReadImageOptions {
  /** Allowed directories, or null for no restriction. */
  allowedDirs: string[] | null;
  maxBytes?: number;
}

/**
 * Reads a local image file safely and returns its bytes.
 * Throws InputError with a message that is safe to show to the user.
 */
export async function readImageFile(inputPath: string, opts: ReadImageOptions): Promise<Buffer> {
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new InputError("image_path is empty.");
  }
  if (inputPath.includes("\0")) throw new InputError("image_path contains a null byte.");

  const requested = path.resolve(expandHome(inputPath.trim()));

  let real: string;
  try {
    real = await fs.realpath(requested);
  } catch {
    throw new InputError(
      opts.allowedDirs
        ? `File not found, not readable or not allowed: ${requested}`
        : `File not found or not readable: ${requested}`,
    );
  }

  // The allowlist is checked on the resolved target, so a symlink inside an allowed
  // directory cannot point outside it.
  if (opts.allowedDirs) {
    const allowed = await realAllowedDirs(opts.allowedDirs);
    if (!allowed.some((dir) => isInside(real, dir))) {
      throw new InputError(
        `Refused: ${requested} is outside the directories allowed by NEOSATOSHI_ALLOWED_DIRS.`,
      );
    }
  }

  const st = await fs.lstat(real);
  if (!st.isFile()) {
    throw new InputError(`Not a regular file (directories, devices, sockets and pipes are refused): ${requested}`);
  }

  const ext = path.extname(real).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new InputError(`Only .jpg, .jpeg and .png files are accepted (got "${ext || "no extension"}").`);
  }
  if (st.size > maxBytes) {
    throw new InputError(`Image is larger than ${MAX_MB} MB (${(st.size / 1048576).toFixed(1)} MB).`);
  }
  if (st.size === 0) throw new InputError("Image file is empty.");

  // O_NOFOLLOW refuses a symlink swapped in after realpath; O_NONBLOCK keeps a swapped-in
  // FIFO from blocking the open. The fstat below re-checks the opened file itself.
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0);
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(real, flags);
  } catch {
    throw new InputError(`Could not open the file: ${requested}`);
  }
  try {
    const fst = await handle.stat();
    if (!fst.isFile()) throw new InputError(`Not a regular file: ${requested}`);
    if (fst.size > maxBytes) throw new InputError(`Image is larger than ${MAX_MB} MB.`);
    const buf = Buffer.alloc(fst.size);
    let offset = 0;
    while (offset < buf.length) {
      const { bytesRead } = await handle.read(buf, offset, buf.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const data = buf.subarray(0, offset);
    if (!sniffImageType(data)) {
      throw new InputError("The file is not a JPEG or PNG image (checked by its content, not its name).");
    }
    return data;
  } finally {
    await handle.close();
  }
}

/**
 * Validates a base64 image (plain base64 or a data: URL) and returns normalized base64.
 */
export function normalizeBase64Image(input: string, maxBytes: number = MAX_IMAGE_BYTES): string {
  if (typeof input !== "string" || input.trim() === "") throw new InputError("image_base64 is empty.");
  let b64 = input.trim();
  const dataUrl = /^data:image\/(png|jpe?g);base64,/i.exec(b64);
  if (dataUrl) b64 = b64.slice(dataUrl[0].length);
  else if (b64.startsWith("data:")) throw new InputError("image_base64 data URL must be image/jpeg or image/png.");
  b64 = b64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(b64)) throw new InputError("image_base64 is not valid base64.");
  // Rough upper bound before decoding, so a huge string is refused cheaply.
  if (Math.floor((b64.length * 3) / 4) > maxBytes + 3) {
    throw new InputError(`Image is larger than ${MAX_MB} MB.`);
  }
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) throw new InputError("image_base64 decodes to nothing.");
  if (buf.length > maxBytes) throw new InputError(`Image is larger than ${MAX_MB} MB.`);
  if (!sniffImageType(buf)) throw new InputError("image_base64 is not a JPEG or PNG image.");
  return buf.toString("base64");
}

/**
 * Checks that image_url is an https URL. The server never fetches it; the API does.
 */
export function validateImageUrl(input: string): string {
  if (typeof input !== "string" || input.trim() === "") throw new InputError("image_url is empty.");
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InputError("image_url is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new InputError("image_url must start with https://");
  return input.trim();
}
