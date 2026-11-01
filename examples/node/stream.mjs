#!/usr/bin/env node
// Print each card as soon as it is recognised (Server-Sent Events).
//
// Usage: node stream.mjs <image_url> [tcg]
//   image_url: public https link to a JPEG or PNG
//   tcg:       pokemon (default), onepiece, lorcana, yugioh, magic
//
// Streaming helps with Pokémon binder pages. The other games have one card per
// photo, so there you get progress events, not a faster result.
//
// Node.js 18 or newer (built-in fetch), no dependencies.
// Uses NEOSATOSHI_API_KEY, or the public demo key (10 detections per day per network).

const ENDPOINT = "https://europe-west1-neosatoshi.cloudfunctions.net/detectApi";
const DEMO_KEY = "nsk_live_9c253fbed995042a98280ad13e5c47d3c4a59c9b4f0f7274";

const [imageUrl, tcg = "pokemon"] = process.argv.slice(2);
if (!imageUrl) {
  console.error("Usage: node stream.mjs <image_url> [tcg]");
  process.exit(2);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${process.env.NEOSATOSHI_API_KEY || DEMO_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ image_url: imageUrl, tcg, stream: true }),
});

// Errors before the detection starts are plain JSON, as without streaming.
if (!res.headers.get("content-type")?.startsWith("text/event-stream")) {
  console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}

function handle(event, data) {
  if (event === "progress") console.log("stage:", data.stage);
  if (event === "card") console.log(`${data.index + 1}. ${data.card.full_name ?? data.card.name} | ${data.card.set.name} #${data.card.set.number}`);
  if (event === "error") throw new Error(`${data.status} ${data.error}: ${data.message}`);
  if (event === "done") {
    console.log(`Done: ${data.count} card(s)`); // data is the same body as the normal JSON response
    for (const w of data.warnings ?? []) console.log("Warning:", w.message);
  }
  return event === "done" || event === "error";
}

let buffer = "";
let finished = false;
const decoder = new TextDecoder();
for await (const chunk of res.body) {
  buffer += decoder.decode(chunk, { stream: true });
  let end;
  while ((end = buffer.indexOf("\n\n")) >= 0) {
    const block = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const event = block.match(/^event: (.*)$/m)?.[1];
    const data = block.match(/^data: (.*)$/m)?.[1];
    if (event && data) finished = handle(event, JSON.parse(data)) || finished;
  }
}
// No final event: the outcome is unknown and cards may be charged. Do not resend automatically.
if (!finished) throw new Error("The stream ended without a result.");
