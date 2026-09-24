/**
 * Sit Down Sundays — Homepage Hero Content
 *
 * Centralized, editable hero copy so it can later be replaced by CMS content.
 * Do not hard-code this copy inside the hero component.
 *
 * All content here is PROVISIONAL — final brand copy pending.
 */

export interface HeroContent {
  /** Small label above the headline. */
  eyebrow: string;
  /** Main display headline. */
  headline: string;
  /** Supporting paragraph. */
  supportingText: string;
  /** Primary call to action. */
  primaryAction: { label: string; to: string };
  /** Secondary call to action. */
  secondaryAction: { label: string; to: string };
  /** Accessible description of the background photograph (decorative behind text). */
  imageAlt: string;
}

/**
 * PROVISIONAL hero image asset.
 *
 * This is a generated placeholder, NOT an approved brand asset.
 * Replace `heroImage` with the final approved photograph when available.
 *
 * Recommended final image:
 *   - Dimensions: 2400×1350px (16:9), optimized/compressed (WebP/AVIF preferred)
 *   - Focal position: subject (people + food) biased to the right two-thirds,
 *     leaving the left third visually open for overlaid text
 *   - Subject: multigenerational family sharing a Sunday meal, warm late-afternoon light
 */
export const HERO_IMAGE_SRC =
  "https://vibe.filesafe.space/1790115564962639543/attachments/baca8ea2-4380-4ca3-bd76-dc0b3c5fd76c.png";

export const HOME_HERO_CONTENT: HeroContent = {
  eyebrow: "A Sunday worth gathering for",
  headline: "Come Sit Down With Us",
  supportingText:
    "Good food tastes even better when it is shared. Sit Down Sundays brings family, friends, and community together around one thoughtfully prepared table.",
  primaryAction: { label: "Join the Waitlist", to: "/waitlist" },
  secondaryAction: { label: "Explore the Experience", to: "/the-experience" },
  imageAlt:
    "A joyful multigenerational African American family sharing an abundant Sunday meal together with warm conversation around a homestyle dining table in late-afternoon natural light.",
};
