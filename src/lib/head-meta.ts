interface MetaInput {
  title: string;
  description: string;
}

/** Standard head metadata for internal routes (noindex, no og:image). */
export function internalHead({ title, description }: MetaInput) {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "noindex, nofollow" },
    ],
  };
}
