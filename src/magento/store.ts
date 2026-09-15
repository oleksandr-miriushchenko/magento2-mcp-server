import { z } from "zod";

import { createAppError, ERROR_CODE } from "../core/errors.js";
import type { MagentoClient } from "./client.js";

const MagentoFlagSchema = z.boolean().or(z.literal(0)).or(z.literal(1));

const RawWebsiteSchema = z.object({
  id: z.number().int().nonnegative(),
  code: z.string().min(1),
  name: z.string().min(1),
  default_group_id: z.number().int().nonnegative(),
});

const RawStoreGroupSchema = z.object({
  id: z.number().int().nonnegative(),
  website_id: z.number().int().nonnegative(),
  root_category_id: z.number().int().nonnegative(),
  default_store_id: z.number().int().nonnegative(),
  name: z.string().min(1),
});

const RawStoreViewSchema = z.object({
  id: z.number().int().nonnegative(),
  code: z.string().min(1),
  name: z.string().min(1),
  website_id: z.number().int().nonnegative(),
  store_group_id: z.number().int().nonnegative(),
  is_active: MagentoFlagSchema,
});

const RawWebsiteListSchema = z.array(RawWebsiteSchema);
const RawStoreGroupListSchema = z.array(RawStoreGroupSchema);
const RawStoreViewListSchema = z.array(RawStoreViewSchema);

export type RawWebsite = z.infer<typeof RawWebsiteSchema>;
export type RawStoreGroup = z.infer<typeof RawStoreGroupSchema>;
export type RawStoreView = z.infer<typeof RawStoreViewSchema>;

export interface RawStoreHierarchy {
  readonly websites: readonly RawWebsite[];
  readonly groups: readonly RawStoreGroup[];
  readonly views: readonly RawStoreView[];
}

export interface StoreReader {
  getHierarchy(signal: AbortSignal, onAttempt?: () => void): Promise<RawStoreHierarchy>;
}

export class MagentoStore implements StoreReader {
  constructor(private readonly client: MagentoClient) {}

  async getHierarchy(signal: AbortSignal, onAttempt?: () => void): Promise<RawStoreHierarchy> {
    const options = {
      signal,
      ...(onAttempt === undefined ? {} : { onAttempt }),
    };
    const [websitesRaw, groupsRaw, viewsRaw] = await Promise.all([
      this.client.getJson(["V1", "store", "websites"], options),
      this.client.getJson(["V1", "store", "storeGroups"], options),
      this.client.getJson(["V1", "store", "storeViews"], options),
    ]);
    const websites = RawWebsiteListSchema.safeParse(websitesRaw);
    const groups = RawStoreGroupListSchema.safeParse(groupsRaw);
    const views = RawStoreViewListSchema.safeParse(viewsRaw);
    if (!websites.success || !groups.success || !views.success) {
      throw createAppError(ERROR_CODE.UPSTREAM_INVALID_RESPONSE);
    }
    return { websites: websites.data, groups: groups.data, views: views.data };
  }
}
