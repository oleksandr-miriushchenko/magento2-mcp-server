import type { OrderReader } from "../../../magento/orders.js";
import { mapOrder } from "./mapper.js";
import type { OrderGetData } from "./schemas.js";

export interface OrderGetWorkflow {
  execute(orderId: number, signal: AbortSignal, onAttempt?: () => void): Promise<OrderGetData>;
}

export function createOrderGetWorkflow(orders: OrderReader): OrderGetWorkflow {
  return {
    async execute(orderId, signal, onAttempt) {
      const order = await orders.getOrder(orderId, signal, onAttempt);
      return mapOrder(order);
    },
  };
}
