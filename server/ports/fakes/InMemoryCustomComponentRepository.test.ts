import { describe } from "node:test";
import { customComponentRepositoryCases } from "./customComponentRepositoryCases";
import { InMemoryCustomComponentRepository } from "./InMemoryCustomComponentRepository";

describe("InMemoryCustomComponentRepository", () => {
  customComponentRepositoryCases(async () => new InMemoryCustomComponentRepository());
});
