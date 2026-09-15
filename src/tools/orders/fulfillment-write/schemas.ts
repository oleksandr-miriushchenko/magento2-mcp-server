import { z } from "zod";

import { AUDIT_TOOL } from "../../../core/audit.js";
import { WRITE_ERROR_CODE } from "../../shared/error-codes.js";
import { createToolResultSchemas, type ToolFailure } from "../../shared/result-schemas.js";

export const FULFILLMENT_WRITE_TOOL = {
  ORDER_CANCEL: AUDIT_TOOL.ORDER_CANCEL,
  ORDER_HOLD: AUDIT_TOOL.ORDER_HOLD,
  ORDER_UNHOLD: AUDIT_TOOL.ORDER_UNHOLD,
  ORDER_EMAIL_SEND: AUDIT_TOOL.ORDER_EMAIL_SEND,
  INVOICE_CREATE: AUDIT_TOOL.INVOICE_CREATE,
  SHIPMENT_CREATE: AUDIT_TOOL.SHIPMENT_CREATE,
} as const;

export const FULFILLMENT_WRITE_ERROR_CODE = WRITE_ERROR_CODE;

export const FulfillmentWriteErrorCodeSchema = z.enum(FULFILLMENT_WRITE_ERROR_CODE);

const CommonOrderWriteInputFields = {
  order_id: z.number().int().positive(),
  idempotency_key: z.uuid(),
} as const;

export const OrderCancelInputSchema = z.strictObject(CommonOrderWriteInputFields);
export const OrderHoldInputSchema = z.strictObject(CommonOrderWriteInputFields);
export const OrderUnholdInputSchema = z.strictObject(CommonOrderWriteInputFields);
export const OrderEmailSendInputSchema = z.strictObject(CommonOrderWriteInputFields);

export const InvoiceCreateInputSchema = z.strictObject({
  ...CommonOrderWriteInputFields,
  capture: z.boolean().default(false),
  notify: z.boolean().default(false),
});

function hasUnsafeControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

const ShipmentTrackInputSchema = z.strictObject({
  track_number: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !hasUnsafeControl(value)),
  carrier_code: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/),
  title: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !hasUnsafeControl(value)),
});

export const ShipmentCreateInputSchema = z
  .strictObject({
    ...CommonOrderWriteInputFields,
    notify: z.boolean().default(false),
    tracks: z.array(ShipmentTrackInputSchema).max(10).default([]),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.tracks.forEach((track, index) => {
      const key = `${track.carrier_code.length}:${track.carrier_code}${track.track_number}`;
      if (seen.has(key)) {
        context.addIssue({
          code: "custom",
          path: ["tracks", index],
          message: "Duplicate carrier and tracking number.",
        });
      }
      seen.add(key);
    });
  });

const OrderCancelResultSchemas = createToolResultSchemas(
  z.strictObject({
    order_id: z.number().int().positive(),
    canceled: z.literal(true),
  }),
  FulfillmentWriteErrorCodeSchema,
);
export const OrderCancelOutputSchema = OrderCancelResultSchemas.output;

const OrderHoldResultSchemas = createToolResultSchemas(
  z.strictObject({
    order_id: z.number().int().positive(),
    held: z.literal(true),
  }),
  FulfillmentWriteErrorCodeSchema,
);
export const OrderHoldOutputSchema = OrderHoldResultSchemas.output;

const OrderUnholdResultSchemas = createToolResultSchemas(
  z.strictObject({
    order_id: z.number().int().positive(),
    unheld: z.literal(true),
  }),
  FulfillmentWriteErrorCodeSchema,
);
export const OrderUnholdOutputSchema = OrderUnholdResultSchemas.output;

const OrderEmailSendResultSchemas = createToolResultSchemas(
  z.strictObject({
    order_id: z.number().int().positive(),
    email_sent: z.literal(true),
  }),
  FulfillmentWriteErrorCodeSchema,
);
export const OrderEmailSendOutputSchema = OrderEmailSendResultSchemas.output;

const InvoiceCreateResultSchemas = createToolResultSchemas(
  z.strictObject({
    order_id: z.number().int().positive(),
    invoice_id: z.number().int().positive(),
    capture_requested: z.boolean(),
    notification_requested: z.boolean(),
  }),
  FulfillmentWriteErrorCodeSchema,
);
export const InvoiceCreateOutputSchema = InvoiceCreateResultSchemas.output;

const ShipmentCreateResultSchemas = createToolResultSchemas(
  z.strictObject({
    order_id: z.number().int().positive(),
    shipment_id: z.number().int().positive(),
    notification_requested: z.boolean(),
    tracking_count: z.number().int().min(0).max(10),
  }),
  FulfillmentWriteErrorCodeSchema,
);
export const ShipmentCreateOutputSchema = ShipmentCreateResultSchemas.output;

export type OrderCancelInput = z.infer<typeof OrderCancelInputSchema>;
export type OrderHoldInput = z.infer<typeof OrderHoldInputSchema>;
export type OrderUnholdInput = z.infer<typeof OrderUnholdInputSchema>;
export type OrderEmailSendInput = z.infer<typeof OrderEmailSendInputSchema>;
export type InvoiceCreateInput = z.infer<typeof InvoiceCreateInputSchema>;
export type ShipmentCreateInput = z.infer<typeof ShipmentCreateInputSchema>;
export type OrderCancelSuccess = z.infer<typeof OrderCancelResultSchemas.success>;
export type OrderHoldSuccess = z.infer<typeof OrderHoldResultSchemas.success>;
export type OrderUnholdSuccess = z.infer<typeof OrderUnholdResultSchemas.success>;
export type OrderEmailSendSuccess = z.infer<typeof OrderEmailSendResultSchemas.success>;
export type InvoiceCreateSuccess = z.infer<typeof InvoiceCreateResultSchemas.success>;
export type ShipmentCreateSuccess = z.infer<typeof ShipmentCreateResultSchemas.success>;
export type FulfillmentWriteFailure = ToolFailure<typeof FulfillmentWriteErrorCodeSchema>;
export type OrderCancelOutput = z.infer<typeof OrderCancelOutputSchema>;
export type OrderHoldOutput = z.infer<typeof OrderHoldOutputSchema>;
export type OrderUnholdOutput = z.infer<typeof OrderUnholdOutputSchema>;
export type OrderEmailSendOutput = z.infer<typeof OrderEmailSendOutputSchema>;
export type InvoiceCreateOutput = z.infer<typeof InvoiceCreateOutputSchema>;
export type ShipmentCreateOutput = z.infer<typeof ShipmentCreateOutputSchema>;

export type FulfillmentWriteSuccess =
  | OrderCancelSuccess
  | OrderHoldSuccess
  | OrderUnholdSuccess
  | OrderEmailSendSuccess
  | InvoiceCreateSuccess
  | ShipmentCreateSuccess;

export type FulfillmentWriteOutput =
  | OrderCancelOutput
  | OrderHoldOutput
  | OrderUnholdOutput
  | OrderEmailSendOutput
  | InvoiceCreateOutput
  | ShipmentCreateOutput;
