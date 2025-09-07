import { generateFunctions } from "../src";
import config from "./config";

async function main() {
  // Demonstrates using functions without starting an HTTP server
  const { functions, stop } = await generateFunctions(config);

  // Schema CRUD functions
  const u = await functions.user.insert({ email: "demo@ex.com", password: "p" });
  const o1 = await functions.order.insert({ userId: u.id, total: 10 });
  const o2 = await functions.order.insert({ userId: u.id, total: 25 });
  const found = await functions.user.find({ filter: { email: { contains: "demo" } } });
  console.log("Users:", found);

  // Join function
  const joined = await (functions as any).join.userOrders({ filter: { id: { eq: u.id } } });
  console.log("User with orders:", joined);

  await stop();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
