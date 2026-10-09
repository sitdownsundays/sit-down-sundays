import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy /book route — permanent redirect to /reserve.
 *
 * The reservation wizard now lives at /reserve. This route redirects before
 * rendering (in beforeLoad), so the old wizard never mounts and no redirect
 * loop occurs. All query parameters are preserved by forwarding the parsed
 * search unchanged. The file is retained (not deleted) so the redirect is
 * router-level and backward compatible with existing bookmarks/links.
 */
export const Route = createFileRoute("/_public/book")({
  beforeLoad: ({ search }) => {
    // Preserve query parameters by forwarding the parsed search unchanged.
    throw redirect({ to: "/reserve", search: () => search });
  },
});
