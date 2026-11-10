// Refresh tools.json from the Oasis connector's own tool list (the same list an MCP client gets from tools/list).
//
//   cd <a checkout of maxthegiraffe/oasis at origin/main, with node_modules>
//   deno run -A --no-check --no-lock --node-modules-dir=none <oasis-share>/_tools/agents/dump_connector_tools.ts \
//     "file://$PWD/base44/shared/hostConnectorTools.ts" <oasis-share>/_tools/agents/tools.json
//
// Then: python3 -I _tools/build_agents_page.py   (it refuses a tool that has no example in page.json)
const { TOOLS } = await import(Deno.args[0]);
await Deno.writeTextFile(Deno.args[1], JSON.stringify(TOOLS, null, 1) + "\n");
console.log(`${TOOLS.length} tools: ${TOOLS.map((t: { name: string }) => t.name).join(" ")}`);
