import { createFileRoute } from "@tanstack/react-router";
import { Container } from "@/components/layout/container";
import { PageHeader } from "@/components/layout/page-header";
import { MenuItemCard } from "@/components/layout/menu-item-card";
import { ButtonLink } from "@/components/layout/button-link";
import { MOCK_MENU_ITEMS } from "@/lib/mock";
import type { MenuCategory } from "@/lib/domain/types";

export const Route = createFileRoute("/_public/menu")({
  head: () => ({
    meta: [
      { title: "Menu — Sit Down Sundays" },
      {
        name: "description",
        content:
          "A provisional look at the Sit Down Sundays menu. Final items and prices to be confirmed.",
      },
      { property: "og:title", content: "Menu — Sit Down Sundays" },
      { property: "og:description", content: "A provisional look at the Sit Down Sundays menu." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MenuPage,
});

const CATEGORIES: { key: MenuCategory; label: string }[] = [
  { key: "starter", label: "Starters" },
  { key: "main", label: "Mains" },
  { key: "side", label: "Sides" },
  { key: "dessert", label: "Desserts" },
  { key: "children", label: "Children" },
];

function MenuPage() {
  return (
    <Container className="py-12">
      <PageHeader
        eyebrow="Provisional Menu"
        title="The Sunday Table"
        description="A working sample menu. Items and prices are provisional and will be finalized before opening."
      />
      <div className="mt-12 space-y-12">
        {CATEGORIES.map((cat) => {
          const items = MOCK_MENU_ITEMS.filter((i) => i.category === cat.key);
          if (items.length === 0) return null;
          return (
            <section key={cat.key}>
              <h2 className="font-display text-2xl font-bold text-foreground">{cat.label}</h2>
              <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((item) => (
                  <MenuItemCard key={item.id} item={item} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="mt-12 flex flex-wrap gap-3">
        <ButtonLink to="/waitlist">Join the Waitlist</ButtonLink>
        <ButtonLink to="/how-it-works" variant="outline">
          How it works
        </ButtonLink>
      </div>
    </Container>
  );
}
