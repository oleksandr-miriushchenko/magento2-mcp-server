import { z } from "zod";

import { RESOURCE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas } from "../../shared/result-schemas.js";
import { MagentoDateTimeOutputSchema } from "../../shared/schemas.js";

export const CUSTOMER_GET_TOOL = "customer_get";
const ErrorCodeSchema = z.enum(RESOURCE_ERROR_CODE);
const AddressSchema = z.strictObject({
  address_id: z.number().int().positive(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  company: z.string().nullable(),
  street: z.array(z.string()).nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  region_code: z.string().nullable(),
  postcode: z.string().nullable(),
  country_code: z.string().nullable(),
  telephone: z.string().nullable(),
  is_default_shipping: z.boolean(),
  is_default_billing: z.boolean(),
});
const CustomerGetDataSchema = z.strictObject({
  customer_id: z.number().int().positive(),
  group_id: z.number().int().nonnegative(),
  store_id: z.number().int().nonnegative(),
  website_id: z.number().int().nonnegative(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string(),
  created_at: MagentoDateTimeOutputSchema,
  updated_at: MagentoDateTimeOutputSchema,
  addresses: z
    .array(AddressSchema)
    .describe(
      "Saved customer addresses. An empty array means the customer has no saved addresses.",
    ),
});
export const CustomerGetInputSchema = z.strictObject({
  customer_id: z.number().int().positive(),
});
export const CustomerGetOutputSchema = createToolResultSchemas(
  CustomerGetDataSchema,
  ErrorCodeSchema,
).output;
export type CustomerGetOutput = z.infer<typeof CustomerGetOutputSchema>;
