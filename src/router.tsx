import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import type { SessionState } from "@/lib/auth/types";

const UNAUTHENTICATED: SessionState = { authenticated: false };

export interface RouterContext {
  queryClient: QueryClient;
  session: SessionState;
}

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient, session: UNAUTHENTICATED },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
