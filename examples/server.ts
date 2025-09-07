import config from "./config";
import { buildAutoCRUD } from "../src";

async function main() {
  const orch = await buildAutoCRUD(config);
  await orch.start();
  console.log(`Server ready on http://localhost:${config.server?.port ?? 4000}`);
  if (config.server?.restEnabled !== false) console.log(`REST base: ${config.server?.basePath ?? "/api"}`);
  if (config.server?.graphqlEnabled !== false) console.log(`GraphQL: ${config.server?.graphqlPath ?? "/graphql"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

