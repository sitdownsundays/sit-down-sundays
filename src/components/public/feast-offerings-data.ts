import { queryOptions } from "@tanstack/react-query";
import { listPublishedFeastOfferings } from "@/lib/feast.functions";
import type { FeastOfferingDTO } from "@/lib/feast/types";

export const publishedFeastOfferingsQueryOptions = () =>
  queryOptions({
    queryKey: ["published-feast-offerings"],
    queryFn: async (): Promise<FeastOfferingDTO[]> => {
      return listPublishedFeastOfferings();
    },
    staleTime: 0, // Fresh on each route visit
  });
