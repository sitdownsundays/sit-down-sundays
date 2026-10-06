import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { ButtonLink } from "@/components/layout/button-link";
import { ErrorState } from "@/components/layout/error-state";
import { PublicMenuView } from "@/components/public/public-menu-view";
import {
  publishedMenusQueryOptions,
  publishedMenuBySlugQueryOptions,
} from "@/components/public/public-menu-data";

export const Route = createFileRoute("/_public/menu")({
  head: () => ({
    meta: [
      { title: "Menu — Sit Down Sundays" },
      {
        name: "description",
        content:
          "A look at the Sit Down Sundays menu — shared dishes gathered around one table. Items and prices are provisional until finalized.",
      },
      { property: "og:title", content: "Menu — Sit Down Sundays" },
      {
        property: "og:description",
        content: "A look at the Sit Down Sundays menu — shared dishes gathered around one table.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async ({ context }) => {
    // Prime the published-menu list cache for SSR + hydration. The single-menu
    // query is fetched on demand by the selector; both use staleTime: 0 so CMS
    // edits are reflected on return navigation.
    await context.queryClient.ensureQueryData(publishedMenusQueryOptions());
  },
  errorComponent: ({ error, reset }) => (
    <Container className="py-16">
      <ErrorState
        title="Menu could not be loaded"
        message="Something went wrong while loading the menu. Please try again."
        action={
          <button
            type="button"
            onClick={() => {
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
        }
      />
      <p className="sr-only">{error instanceof Error ? error.message : "Unexpected error"}</p>
    </Container>
  ),
  component: MenuPage,
});

function MenuPage() {
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="The Sunday Table"
        title="Our Menu"
        description="Shared dishes gathered around one table. Items and prices are provisional until finalized."
      />
      <PublicMenuView
        listOptions={publishedMenusQueryOptions()}
        bySlugOptions={publishedMenuBySlugQueryOptions}
      />
      <div className="mt-12 flex flex-wrap gap-3">
        <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        <ButtonLink to="/how-it-works" variant="outline">
          How it works
        </ButtonLink>
      </div>
    </Container>
  );
}
