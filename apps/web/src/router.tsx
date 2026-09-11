import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Root } from "./routes/Root.tsx";
import { Products } from "./routes/Products.tsx";
import { ProductHome } from "./routes/ProductHome.tsx";
import { Templates } from "./routes/Templates.tsx";
import { Runs } from "./routes/Runs.tsx";
import { Day } from "./routes/Day.tsx";
import { Runner } from "./routes/Runner.tsx";
import { TemplatePage } from "./routes/TemplatePage.tsx";
import { FlowEditor } from "./routes/FlowEditor.tsx";
import { TestLibrary } from "./routes/TestLibrary.tsx";

const root = createRootRoute({ component: Root });
const index = createRoute({ getParentRoute: () => root, path: "/", component: Products });
const product = createRoute({ getParentRoute: () => root, path: "/products/$productId", component: ProductHome });
const templates = createRoute({ getParentRoute: () => root, path: "/products/$productId/templates", component: Templates });
const runsPage = createRoute({ getParentRoute: () => root, path: "/products/$productId/runs", component: Runs });
const day = createRoute({ getParentRoute: () => root, path: "/products/$productId/runs/$runId", component: Day });
const templatePage = createRoute({ getParentRoute: () => root, path: "/products/$productId/templates/$templateId", component: TemplatePage });
const flowEditor = createRoute({ getParentRoute: () => root, path: "/products/$productId/templates/$templateId/flows/$flowId", component: FlowEditor });
const library = createRoute({
  getParentRoute: () => root,
  path: "/products/$productId/tests",
  component: TestLibrary,
  validateSearch: (s: Record<string, unknown>) => ({ test: typeof s.test === "string" ? s.test : undefined }),
});
const runner = createRoute({ getParentRoute: () => root, path: "/products/$productId/runs/$runId/flows/$flowRunId", component: Runner });

export const router = createRouter({ routeTree: root.addChildren([index, product, templates, runsPage, day, runner, templatePage, flowEditor, library]) });

declare module "@tanstack/react-router" {
  interface Register { router: typeof router; }
}
