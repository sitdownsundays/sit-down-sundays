import { ButtonLink } from "@/components/layout/button-link";
import { Container } from "@/components/layout/container";
import { HOME_HERO_CONTENT, HERO_IMAGE_SRC } from "@/lib/content/hero-content";

/**
 * Full-width, image-cover homepage hero.
 *
 * The background photograph is decorative (the same meaning is conveyed by the
 * visible text), so the <img> is marked aria-hidden to avoid duplicate
 * screen-reader announcements. A layered warm-charcoal gradient preserves the
 * photograph's warmth while guaranteeing text contrast.
 *
 * Hero content is sourced from the centralized `HOME_HERO_CONTENT` module so it
 * can be swapped for CMS content later without touching this component.
 */
export function HomeHero() {
  const { eyebrow, headline, supportingText, primaryAction, secondaryAction, imageAlt } =
    HOME_HERO_CONTENT;

  return (
    <section
      className="relative flex min-h-[680px] w-full items-center overflow-hidden bg-charcoal sm:min-h-[700px] lg:min-h-[82vh]"
      aria-labelledby="home-hero-heading"
    >
      {/* Background photograph — decorative; meaning is conveyed by visible text */}
      <img
        src={HERO_IMAGE_SRC}
        alt=""
        aria-hidden
        fetchPriority="high"
        className="absolute inset-0 size-full object-cover object-[62%_center]"
      />
      {/* Accessible description for the decorative image (visually hidden) */}
      <span className="sr-only">{imageAlt}</span>

      {/* Layered warm overlay for readability */}
      <div
        className="absolute inset-0 bg-gradient-to-r from-charcoal/90 via-charcoal/55 to-charcoal/10"
        aria-hidden
      />
      {/* Stronger mobile vertical overlay (text occupies more of the photo) */}
      <div
        className="absolute inset-0 bg-gradient-to-t from-charcoal/85 via-charcoal/30 to-charcoal/40 lg:hidden"
        aria-hidden
      />

      {/* Content */}
      <Container className="relative z-10 py-24 sm:py-28 lg:py-32">
        <div className="max-w-[640px]">
          <p className="inline-flex items-center rounded-full border border-gold/40 bg-charcoal/30 px-3 py-1 text-sm font-medium text-gold backdrop-blur-sm">
            {eyebrow}
          </p>
          <h1
            id="home-hero-heading"
            className="mt-5 font-display text-4xl font-bold leading-[1.05] text-cream drop-shadow-sm sm:text-5xl lg:text-6xl"
          >
            {headline}
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-cream/90 drop-shadow-sm">
            {supportingText}
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <ButtonLink to={primaryAction.to} variant="gold" size="lg">
              {primaryAction.label}
            </ButtonLink>
            <ButtonLink
              to={secondaryAction.to}
              variant="outline"
              size="lg"
              className="border-cream/40 bg-cream/10 text-cream backdrop-blur-sm hover:bg-cream/20 hover:text-cream"
            >
              {secondaryAction.label}
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-cream/70">
            Provisional content — final details coming soon.
          </p>
        </div>
      </Container>
    </section>
  );
}
