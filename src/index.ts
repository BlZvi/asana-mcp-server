#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AsanaClientWrapper } from "./asana-client-wrapper.js";
import { registerPrompts } from "./prompt-handler.js";
import { registerResources } from "./resource-handler.js";
import { registerTools } from "./tool-handler.js";
import { VERSION } from "./version.js";

async function main() {
  const asanaToken = process.env.ASANA_ACCESS_TOKEN;

  if (!asanaToken) {
    console.error("Please set ASANA_ACCESS_TOKEN environment variable");
    process.exit(1);
  }

  console.error("Starting Asana MCP Server...");
  const server = new McpServer({
    name: "Asana MCP Server",
    version: VERSION,
  });

  const client = new AsanaClientWrapper(asanaToken);

  registerTools(server, client);
  registerPrompts(server, client);
  await registerResources(server, client);

  const transport = new StdioServerTransport();
  console.error("Connecting server to transport...");
  await server.connect(transport);

  console.error("Asana MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
