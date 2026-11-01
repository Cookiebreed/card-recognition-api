#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
// stdout carries the protocol; diagnostics go to stderr and never include the API key.
console.error("neosatoshi-card-mcp ready on stdio");
