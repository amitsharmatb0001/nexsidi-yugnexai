import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db/pool";

export interface OrderItem {
  id: string;
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
}

export interface Order {
  id: string;
  user_id: string;
  pickup_time: string;
  status: string;
  total_price: number;
  created_at: string;
  items: OrderItem[];
}

const createOrderSchema = z.object({
  pickup_time: z.string().min(1, "Pickup time is required"),
  items: z
    .array(
      z.object({
        menu_item_id: z.string().uuid("Invalid menu_item_id format"),
        quantity: z.number().int().positive("Quantity must be at least 1"),
        notes: z.string().optional(),
      })
    )
    .min(1, "At least one menu item is required"),
});

const updateStatusSchema = z.object({
  status: z.enum(["pending", "preparing", "ready", "completed", "cancelled"], {
    errorMap: () => ({
      message: "Status must be pending, preparing, ready, completed, or cancelled",
    }),
  }),
});

export const createOrder = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parseResult = createOrderSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      res.status(400).json({ success: false, error: errorMsg });
      return;
    }

    const { pickup_time, items } = parseResult.data;

    // Get unique menu item IDs to check and fetch
    const uniqueItemIds = Array.from(new Set(items.map((it) => it.menu_item_id)));

    // Fetch items to validate existence, availability, and prices
    const dbItemsResult = await pool.query(
      "SELECT id, name, price, is_available FROM menu_items WHERE id = ANY($1::uuid[])",
      [uniqueItemIds]
    );

    const dbItems = dbItemsResult.rows;
    const dbItemsMap = new Map(dbItems.map((item) => [item.id, item]));

    let totalPrice = 0;

    // Validate each requested item
    for (const item of items) {
      const dbItem = dbItemsMap.get(item.menu_item_id);
      if (!dbItem) {
        res.status(400).json({
          success: false,
          error: `Menu item with ID ${item.menu_item_id} not found`,
        });
        return;
      }
      if (!dbItem.is_available) {
        res.status(400).json({
          success: false,
          error: `Menu item '${dbItem.name}' is out of stock`,
        });
        return;
      }
      const itemPrice =
        typeof dbItem.price === "string" ? parseFloat(dbItem.price) : dbItem.price;
      totalPrice += itemPrice * item.quantity;
    }

    // Round total price to 2 decimal places
    totalPrice = Math.round(totalPrice * 100) / 100;

    // Run transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const orderResult = await client.query(
        "INSERT INTO orders (user_id, pickup_time, status, total_price) VALUES ($1, $2, 'pending', $3) RETURNING id, user_id, pickup_time, status, total_price, created_at",
        [req.userId, pickup_time, totalPrice]
      );
      const orderRow = orderResult.rows[0];

      const insertValues: any[] = [];
      const valuePlaceholders: string[] = [];
      let paramIndex = 1;

      for (const item of items) {
        const dbItem = dbItemsMap.get(item.menu_item_id)!;
        const itemPrice =
          typeof dbItem.price === "string" ? parseFloat(dbItem.price) : dbItem.price;

        valuePlaceholders.push(
          `($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`
        );
        insertValues.push(
          orderRow.id,
          item.menu_item_id,
          item.quantity,
          item.notes || null,
          itemPrice,
          dbItem.name
        );
      }

      const query = `
        INSERT INTO order_items (order_id, menu_item_id, quantity, notes, price, name)
        VALUES ${valuePlaceholders.join(", ")}
        RETURNING id, menu_item_id, quantity, notes, price, name
      `;

      const itemsResult = await client.query(query, insertValues);
      const insertedItems: OrderItem[] = itemsResult.rows.map((row) => ({
        id: row.id,
        menu_item_id: row.menu_item_id,
        name: row.name,
        price: typeof row.price === "string" ? parseFloat(row.price) : row.price,
        quantity: row.quantity,
        notes: row.notes || undefined,
      }));

      await client.query("COMMIT");

      const responseOrder: Order = {
        id: orderRow.id,
        user_id: orderRow.user_id,
        pickup_time: orderRow.pickup_time,
        status: orderRow.status,
        total_price:
          typeof orderRow.total_price === "string"
            ? parseFloat(orderRow.total_price)
            : orderRow.total_price,
        created_at: orderRow.created_at.toISOString(),
        items: insertedItems,
      };

      res.status(201).json({
        success: true,
        data: { order: responseOrder },
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    next(error);
  }
};

export const getMyOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { limit, offset } = req.query;

    let limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum <= 0) {
      limitNum = 50; // default safe limit
    }
    let offsetNum = parseInt(offset as string, 10);
    if (isNaN(offsetNum) || offsetNum < 0) {
      offsetNum = 0;
    }

    const ordersResult = await pool.query(
      `SELECT id AS order_id, user_id, pickup_time, status, total_price, created_at
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [req.userId, limitNum, offsetNum]
    );

    if (ordersResult.rows.length === 0) {
      res.status(200).json({
        success: true,
        data: { orders: [] },
      });
      return;
    }

    const orderIds = ordersResult.rows.map((row) => row.order_id);

    const itemsResult = await pool.query(
      `SELECT id AS item_id, order_id, menu_item_id, quantity, notes, name, price
       FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [orderIds]
    );

    const ordersMap = new Map<string, Order>();

    for (const row of ordersResult.rows) {
      ordersMap.set(row.order_id, {
        id: row.order_id,
        user_id: row.user_id,
        pickup_time: row.pickup_time,
        status: row.status,
        total_price:
          typeof row.total_price === "string"
            ? parseFloat(row.total_price)
            : row.total_price,
        created_at: row.created_at.toISOString(),
        items: [],
      });
    }

    for (const row of itemsResult.rows) {
      const order = ordersMap.get(row.order_id);
      if (order && row.item_id) {
        order.items.push({
          id: row.item_id,
          menu_item_id: row.menu_item_id,
          name: row.name,
          price:
            typeof row.price === "string"
              ? parseFloat(row.price)
              : row.price,
          quantity: row.quantity,
          notes: row.notes || undefined,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: { orders: Array.from(ordersMap.values()) },
    });
  } catch (error) {
    next(error);
  }
};

export const getAllOrders = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { status, limit, offset } = req.query;

    let limitNum = parseInt(limit as string, 10);
    if (isNaN(limitNum) || limitNum <= 0) {
      limitNum = 50; // default safe limit
    }
    let offsetNum = parseInt(offset as string, 10);
    if (isNaN(offsetNum) || offsetNum < 0) {
      offsetNum = 0;
    }

    let queryConditions: string[] = [];
    const queryParams: any[] = [];

    if (status) {
      const statusStr = status as string;
      const validStatuses = ["pending", "preparing", "ready", "completed", "cancelled"];
      if (!validStatuses.includes(statusStr)) {
        res.status(400).json({
          success: false,
          error: "Status must be pending, preparing, ready, completed, or cancelled",
        });
        return;
      }
      queryConditions.push("o.status = $" + (queryParams.length + 1));
      queryParams.push(statusStr);
    }

    const whereClause = queryConditions.length > 0 ? `WHERE ${queryConditions.join(" AND ")}` : "";

    const ordersResult = await pool.query(
      `SELECT o.id AS order_id, o.user_id, o.pickup_time, o.status, o.total_price, o.created_at, u.email AS customer_email
       FROM orders o
       INNER JOIN users u ON o.user_id = u.id
       ${whereClause}
       ORDER BY o.created_at DESC
       LIMIT $` + (queryParams.length + 1) + " OFFSET $" + (queryParams.length + 2),
      [...queryParams, limitNum, offsetNum]
    );

    if (ordersResult.rows.length === 0) {
      res.status(200).json({
        success: true,
        data: { orders: [] },
      });
      return;
    }

    const orderIds = ordersResult.rows.map((row) => row.order_id);

    const itemsResult = await pool.query(
      `SELECT id AS item_id, order_id, menu_item_id, quantity, notes, name, price
       FROM order_items
       WHERE order_id = ANY($1::uuid[])
       ORDER BY created_at ASC`,
      [orderIds]
    );

    const ordersMap = new Map<string, Order & { customer_email: string }>();

    for (const row of ordersResult.rows) {
      ordersMap.set(row.order_id, {
        id: row.order_id,
        user_id: row.user_id,
        pickup_time: row.pickup_time,
        status: row.status,
        total_price:
          typeof row.total_price === "string"
            ? parseFloat(row.total_price)
            : row.total_price,
        created_at: row.created_at.toISOString(),
        customer_email: row.customer_email,
        items: [],
      });
    }

    for (const row of itemsResult.rows) {
      const order = ordersMap.get(row.order_id);
      if (order && row.item_id) {
        order.items.push({
          id: row.item_id,
          menu_item_id: row.menu_item_id,
          name: row.name,
          price:
            typeof row.price === "string"
              ? parseFloat(row.price)
              : row.price,
          quantity: row.quantity,
          notes: row.notes || undefined,
        });
      }
    }

    res.status(200).json({
      success: true,
      data: { orders: Array.from(ordersMap.values()) },
    });
  } catch (error) {
    next(error);
  }
};

export const updateOrderStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof id !== "string" || !uuidRegex.test(id)) {
      res.status(400).json({ success: false, error: "Invalid order ID format: must be a UUID" });
      return;
    }

    const parseResult = updateStatusSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      res.status(400).json({ success: false, error: errorMsg });
      return;
    }

    const { status } = parseResult.data;

    const result = await pool.query(
      "UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: "Order not found" });
      return;
    }

    const orderRow = result.rows[0];

    const itemsResult = await pool.query(
      `SELECT id AS item_id, menu_item_id, quantity, notes, name, price
       FROM order_items
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    const items = itemsResult.rows.map((row) => ({
      id: row.item_id,
      menu_item_id: row.menu_item_id,
      name: row.name,
      price:
        typeof row.price === "string"
          ? parseFloat(row.price)
          : row.price,
      quantity: row.quantity,
      notes: row.notes || undefined,
    }));

    const responseOrder: Order = {
      id: orderRow.id,
      user_id: orderRow.user_id,
      pickup_time: orderRow.pickup_time,
      status: orderRow.status,
      total_price:
        typeof orderRow.total_price === "string"
          ? parseFloat(orderRow.total_price)
          : orderRow.total_price,
      created_at: orderRow.created_at.toISOString(),
      items,
    };

    res.status(200).json({
      success: true,
      data: { order: responseOrder },
    });
  } catch (error) {
    next(error);
  }
};
