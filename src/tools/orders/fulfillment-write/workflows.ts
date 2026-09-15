import { canonicalDigest } from "../../../core/canonical-json.js";
import type { IdempotencyStore } from "../../../core/idempotency.js";
import type { FulfillmentWriter } from "../../../magento/fulfillment.js";
import {
  createIdempotentWriteWorkflow,
  type IdempotentWriteInput,
  type IdempotentWriteWorkflow,
} from "../../shared/idempotent-write-workflow.js";
import {
  FULFILLMENT_WRITE_TOOL,
  type InvoiceCreateInput,
  type InvoiceCreateSuccess,
  type OrderCancelInput,
  type OrderCancelSuccess,
  type OrderEmailSendInput,
  type OrderEmailSendSuccess,
  type OrderHoldInput,
  type OrderHoldSuccess,
  type OrderUnholdInput,
  type OrderUnholdSuccess,
  type ShipmentCreateInput,
  type ShipmentCreateSuccess,
} from "./schemas.js";

interface OrderWriteInput extends IdempotentWriteInput {
  readonly order_id: number;
}

export type FulfillmentWriteWorkflow<
  TInput extends OrderWriteInput,
  TSuccess,
> = IdempotentWriteWorkflow<TInput, TSuccess>;

function fingerprint(input: OrderWriteInput): string {
  return canonicalDigest(
    Object.fromEntries(Object.entries(input).filter(([key]) => key !== "idempotency_key")),
  );
}

export function createOrderCancelWorkflow(
  writer: FulfillmentWriter,
  idempotency: IdempotencyStore<OrderCancelSuccess>,
): FulfillmentWriteWorkflow<OrderCancelInput, OrderCancelSuccess> {
  return createIdempotentWriteWorkflow<OrderCancelInput, OrderCancelSuccess>({
    tool: FULFILLMENT_WRITE_TOOL.ORDER_CANCEL,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      await writer.cancelOrder(input.order_id, signal, onAttempt);
      return { ok: true, data: { order_id: input.order_id, canceled: true } };
    },
  });
}

export function createOrderHoldWorkflow(
  writer: FulfillmentWriter,
  idempotency: IdempotencyStore<OrderHoldSuccess>,
): FulfillmentWriteWorkflow<OrderHoldInput, OrderHoldSuccess> {
  return createIdempotentWriteWorkflow<OrderHoldInput, OrderHoldSuccess>({
    tool: FULFILLMENT_WRITE_TOOL.ORDER_HOLD,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      await writer.holdOrder(input.order_id, signal, onAttempt);
      return { ok: true, data: { order_id: input.order_id, held: true } };
    },
  });
}

export function createOrderUnholdWorkflow(
  writer: FulfillmentWriter,
  idempotency: IdempotencyStore<OrderUnholdSuccess>,
): FulfillmentWriteWorkflow<OrderUnholdInput, OrderUnholdSuccess> {
  return createIdempotentWriteWorkflow<OrderUnholdInput, OrderUnholdSuccess>({
    tool: FULFILLMENT_WRITE_TOOL.ORDER_UNHOLD,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      await writer.unholdOrder(input.order_id, signal, onAttempt);
      return { ok: true, data: { order_id: input.order_id, unheld: true } };
    },
  });
}

export function createOrderEmailSendWorkflow(
  writer: FulfillmentWriter,
  idempotency: IdempotencyStore<OrderEmailSendSuccess>,
): FulfillmentWriteWorkflow<OrderEmailSendInput, OrderEmailSendSuccess> {
  return createIdempotentWriteWorkflow<OrderEmailSendInput, OrderEmailSendSuccess>({
    tool: FULFILLMENT_WRITE_TOOL.ORDER_EMAIL_SEND,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      await writer.sendOrderEmail(input.order_id, signal, onAttempt);
      return { ok: true, data: { order_id: input.order_id, email_sent: true } };
    },
  });
}

export function createInvoiceCreateWorkflow(
  writer: FulfillmentWriter,
  idempotency: IdempotencyStore<InvoiceCreateSuccess>,
): FulfillmentWriteWorkflow<InvoiceCreateInput, InvoiceCreateSuccess> {
  return createIdempotentWriteWorkflow<InvoiceCreateInput, InvoiceCreateSuccess>({
    tool: FULFILLMENT_WRITE_TOOL.INVOICE_CREATE,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      const invoiceId = await writer.createInvoice(
        input.order_id,
        input.capture,
        input.notify,
        signal,
        onAttempt,
      );
      return {
        ok: true,
        data: {
          order_id: input.order_id,
          invoice_id: invoiceId,
          capture_requested: input.capture,
          notification_requested: input.notify,
        },
      };
    },
  });
}

export function createShipmentCreateWorkflow(
  writer: FulfillmentWriter,
  idempotency: IdempotencyStore<ShipmentCreateSuccess>,
): FulfillmentWriteWorkflow<ShipmentCreateInput, ShipmentCreateSuccess> {
  return createIdempotentWriteWorkflow<ShipmentCreateInput, ShipmentCreateSuccess>({
    tool: FULFILLMENT_WRITE_TOOL.SHIPMENT_CREATE,
    idempotency,
    fingerprint,
    async mutate(input, signal, onAttempt) {
      const shipmentId = await writer.createShipment(
        input.order_id,
        input.notify,
        input.tracks.map((track) => ({
          trackNumber: track.track_number,
          carrierCode: track.carrier_code,
          title: track.title,
        })),
        signal,
        onAttempt,
      );
      return {
        ok: true,
        data: {
          order_id: input.order_id,
          shipment_id: shipmentId,
          notification_requested: input.notify,
          tracking_count: input.tracks.length,
        },
      };
    },
  });
}
