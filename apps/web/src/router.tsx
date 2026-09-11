import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Root } from "./routes/Root.tsx";
import { Products } from "./routes/Products.tsx";
import { ProductHome } from "./routes/ProductHome.tsx";
import { Day } from "./routes/Day.tsx";
import { Runner } from "./routes/Runner.tsx";

const root = createRootRoute({ component: Root });
const index = createRoute({ getParentRoute: () => root, path: "/", component: Products });
const product = createRoute({ getParentRoute: () => root, path: "/products/$productId", component: ProductHome });
const day = createRoute({ getParentRoute: () => root, path: "/products/$productId/runs/$runId", component: Day });
const runner = createRoute({ getParentRoute: () => root, path: "/products/$productId/runs/$runId/flows/$flowRunId", component: Runner });

export const router = createRouter({ routeTree: root.addChildren([index, product, day, runner]) });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router; }
}
