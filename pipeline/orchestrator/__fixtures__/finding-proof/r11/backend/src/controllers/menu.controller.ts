import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db/pool";

export interface MenuItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  is_available: boolean;
  category: string;
}

interface DBMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  is_available: boolean;
  category: string;
  created_at: Date;
  updated_at: Date;
}

export const formatMenuItem = (row: DBMenuItem): MenuItem => {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    price: typeof row.price === "string" ? parseFloat(row.price) : row.price,
    is_available: row.is_available,
    category: row.category,
  };
};

const createMenuSchema = z.object({
  name: z.string().min(1, "Name is required").max(100, "Name is too long"),
  description: z.string().optional(),
  price: z.number({ required_error: "Price is required" }).nonnegative("Price cannot be negative"),
  is_available: z.boolean().default(true),
  category: z.string().min(1, "Category is required").max(50, "Category is too long"),
});

const updateMenuSchema = z.object({
  name: z.string().min(1, "Name cannot be empty").max(100).optional(),
  description: z.string().optional(),
  price: z.number().nonnegative("Price cannot be negative").optional(),
  is_available: z.boolean().optional(),
  category: z.string().min(1, "Category cannot be empty").max(50).optional(),
});

export const getMenu = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await pool.query(
      "SELECT id, name, description, price, is_available, category FROM menu_items ORDER BY category ASC, name ASC"
    );
    const items = result.rows.map(formatMenuItem);
    res.status(200).json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
};

export const createMenuItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parseResult = createMenuSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      res.status(400).json({ success: false, error: errorMsg });
      return;
    }

    const { name, description, price, is_available, category } = parseResult.data;
    const descValue = description && description.trim() !== "" ? description.trim() : null;

    const result = await pool.query(
      "INSERT INTO menu_items (name, description, price, is_available, category) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name.trim(), descValue, price, is_available, category.trim()]
    );

    res.status(201).json({
      success: true,
      data: { item: formatMenuItem(result.rows[0]) },
    });
  } catch (error) {
    next(error);
  }
};

export const updateMenuItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof id !== "string" || !uuidRegex.test(id)) {
      res.status(400).json({ success: false, error: "Invalid ID format: must be a UUID" });
      return;
    }

    const parseResult = updateMenuSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
      res.status(400).json({ success: false, error: errorMsg });
      return;
    }

    const updates = parseResult.data;

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (updates.name !== undefined) {
      fields.push("name = $" + i++);
      values.push(updates.name.trim());
    }
    if (updates.description !== undefined) {
      fields.push("description = $" + i++);
      values.push(updates.description.trim() === "" ? null : updates.description.trim());
    }
    if (updates.price !== undefined) {
      fields.push("price = $" + i++);
      values.push(updates.price);
    }
    if (updates.is_available !== undefined) {
      fields.push("is_available = $" + i++);
      values.push(updates.is_available);
    }
    if (updates.category !== undefined) {
      fields.push("category = $" + i++);
      values.push(updates.category.trim());
    }

    if (fields.length === 0) {
      res.status(400).json({ success: false, error: "No update fields provided" });
      return;
    }

    values.push(id);
    const query = "UPDATE menu_items SET " + fields.join(", ") + ", updated_at = now() WHERE id = $" + i + " RETURNING *";

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: "Menu item not found" });
      return;
    }

    res.status(200).json({
      success: true,
      data: { item: formatMenuItem(result.rows[0]) },
    });
  } catch (error) {
    next(error);
  }
};
