// File-safety checks. Run with `npm test` (builds first). No network access.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  InputError,
  isInside,
  normalizeBase64Image,
  parseAllowedDirs,
  readImageFile,
  sniffImageType,
  validateImageUrl,
} from "../dist/images.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nsmcp-test-")));
const allowed = path.join(root, "allowed");
const outside = path.join(root, "outside");
fs.mkdirSync(allowed);
fs.mkdirSync(outside);
fs.writeFileSync(path.join(allowed, "card.jpg"), JPEG);
fs.writeFileSync(path.join(allowed, "card.png"), PNG);
fs.writeFileSync(path.join(allowed, "fake.jpg"), "not an image at all");
fs.writeFileSync(path.join(allowed, "notes.txt"), JPEG);
fs.writeFileSync(path.join(allowed, "empty.jpg"), Buffer.alloc(0));
fs.writeFileSync(path.join(outside, "secret.jpg"), JPEG);
fs.mkdirSync(path.join(allowed, "folder.jpg"));
fs.symlinkSync(path.join(outside, "secret.jpg"), path.join(allowed, "link-out.jpg"));
fs.symlinkSync(path.join(allowed, "card.jpg"), path.join(allowed, "link-in.jpg"));

const open = { allowedDirs: null };
const restricted = { allowedDirs: [allowed] };

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test("sniffImageType detects JPEG and PNG by content", () => {
  assert.equal(sniffImageType(JPEG), "jpeg");
  assert.equal(sniffImageType(PNG), "png");
  assert.equal(sniffImageType(Buffer.from("GIF89a")), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
});

test("reads a regular JPEG and PNG", async () => {
  assert.deepEqual(await readImageFile(path.join(allowed, "card.jpg"), open), JPEG);
  assert.deepEqual(await readImageFile(path.join(allowed, "card.png"), open), PNG);
});

test("refuses a file whose content is not an image even with a .jpg name", async () => {
  await assert.rejects(readImageFile(path.join(allowed, "fake.jpg"), open), InputError);
});

test("refuses other extensions even with image content", async () => {
  await assert.rejects(readImageFile(path.join(allowed, "notes.txt"), open), /Only \.jpg/);
});

test("refuses directories, missing files and empty files", async () => {
  await assert.rejects(readImageFile(path.join(allowed, "folder.jpg"), open), /Not a regular file/);
  await assert.rejects(readImageFile(allowed, open), /Not a regular file/);
  await assert.rejects(readImageFile(path.join(allowed, "missing.jpg"), open), /not found/);
  await assert.rejects(readImageFile(path.join(allowed, "empty.jpg"), open), /empty/);
  await assert.rejects(readImageFile("", open), /empty/);
  await assert.rejects(readImageFile("a\0b.jpg", open), /null byte/);
});

test("refuses device files", { skip: process.platform === "win32" }, async () => {
  await assert.rejects(readImageFile("/dev/null", open), /Not a regular file/);
  await assert.rejects(readImageFile("/dev/zero", open), /Not a regular file/);
});

test("enforces the size limit", async () => {
  const big = path.join(allowed, "big.jpg");
  fs.writeFileSync(big, Buffer.concat([JPEG, Buffer.alloc(2048)]));
  await assert.rejects(readImageFile(big, { allowedDirs: null, maxBytes: 1024 }), /larger than/);
  fs.unlinkSync(big);
});

test("allowlist: inside is allowed, outside is refused", async () => {
  assert.deepEqual(await readImageFile(path.join(allowed, "card.jpg"), restricted), JPEG);
  await assert.rejects(readImageFile(path.join(outside, "secret.jpg"), restricted), /NEOSATOSHI_ALLOWED_DIRS/);
});

test("allowlist: ../ traversal is refused", async () => {
  await assert.rejects(
    readImageFile(path.join(allowed, "..", "outside", "secret.jpg"), restricted),
    /NEOSATOSHI_ALLOWED_DIRS/,
  );
});

test("allowlist: symlinks are resolved before the check", async () => {
  await assert.rejects(readImageFile(path.join(allowed, "link-out.jpg"), restricted), /NEOSATOSHI_ALLOWED_DIRS/);
  assert.deepEqual(await readImageFile(path.join(allowed, "link-in.jpg"), restricted), JPEG);
});

test("allowlist: a sibling directory with the same prefix is not inside", () => {
  assert.equal(isInside("/data/cards-private/a.jpg", "/data/cards"), false);
  assert.equal(isInside("/data/cards/a.jpg", "/data/cards"), true);
});

test("allowlist: entries that do not exist grant nothing (fails closed)", async () => {
  await assert.rejects(
    readImageFile(path.join(allowed, "card.jpg"), { allowedDirs: [path.join(root, "nope")] }),
    /NEOSATOSHI_ALLOWED_DIRS/,
  );
});

test("parseAllowedDirs splits on the platform delimiter and treats empty as unrestricted", () => {
  assert.equal(parseAllowedDirs(undefined), null);
  assert.equal(parseAllowedDirs("  "), null);
  const parsed = parseAllowedDirs(["/a", "/b/c", ""].join(path.delimiter));
  assert.deepEqual(parsed, [path.resolve("/a"), path.resolve("/b/c")]);
});

test("normalizeBase64Image accepts JPEG/PNG and data URLs, refuses others", () => {
  assert.equal(normalizeBase64Image(JPEG.toString("base64")), JPEG.toString("base64"));
  assert.equal(normalizeBase64Image(`data:image/png;base64,${PNG.toString("base64")}`), PNG.toString("base64"));
  assert.throws(() => normalizeBase64Image(Buffer.from("hello").toString("base64")), /not a JPEG or PNG/);
  assert.throws(() => normalizeBase64Image("%%%"), /not valid base64/);
  assert.throws(() => normalizeBase64Image(`data:text/plain;base64,${JPEG.toString("base64")}`), /data URL/);
  const big = Buffer.concat([JPEG, Buffer.alloc(4096)]).toString("base64");
  assert.throws(() => normalizeBase64Image(big, 1024), /larger than/);
});

test("validateImageUrl only accepts https", () => {
  assert.equal(validateImageUrl("https://example.com/card.jpg"), "https://example.com/card.jpg");
  assert.throws(() => validateImageUrl("http://example.com/card.jpg"), /https/);
  assert.throws(() => validateImageUrl("file:///etc/passwd"), /https/);
  assert.throws(() => validateImageUrl("not a url"), /valid URL/);
});
