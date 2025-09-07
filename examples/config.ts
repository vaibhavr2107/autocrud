import type { Config } from "../src/config/validators";

const config: Config = {
  server: {
    port: 4000,
    basePath: "/api",
    graphqlPath: "/graphql",
    restEnabled: true,
    graphqlEnabled: true,
  },
  database: { type: "file", url: "./data" },
  schemas: {
    user: {
      file: "./src/schemas/user.json",
      transform: {
        enabled: true,
        operations: {
          beforeSave: { password: (v: string) => `hashed:${v}` },
          afterRead: { password: () => undefined },
        },
      },
      ops: { delete: false }, // disable delete endpoints for user
    },
    order: { file: "./src/schemas/order.json" },
  },
  joins: {
    userOrders: {
      base: "user",
      relations: [
        { schema: "order", localField: "id", foreignField: "userId", as: "orders", type: "left" },
      ],
    },
  },
  cache: { enabled: true, ttl: 60 },
  functional: { enabled: true },
};

export default config;

