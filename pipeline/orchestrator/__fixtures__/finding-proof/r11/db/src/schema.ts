import { boolean, integer, numeric, pgTable, relations, sql, text, timestamp, uuid } from "drizzle-orm/pg-core";


export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password_hash: text("password_hash").notNull(),
  role: text("role").notNull().default('customer'),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  updated_at: timestamp("updated_at").notNull().default(sql`now()`)
});

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  price: numeric(10,2).notNull(),
  is_available: boolean("is_available").notNull().default(true),
  category: text("category").notNull(),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  updated_at: timestamp("updated_at").notNull().default(sql`now()`)
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid("user_id").notNull().references(() => users.id),
  pickup_time: text("pickup_time").notNull(),
  status: text("status").notNull().default('pending'),
  total_price: numeric(10,2).notNull(),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  updated_at: timestamp("updated_at").notNull().default(sql`now()`)
});

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  order_id: uuid("order_id").notNull().references(() => orders.id),
  menu_item_id: uuid("menu_item_id").notNull().references(() => menuItems.id),
  quantity: integer("quantity").notNull().default(1),
  notes: text("notes"),
  created_at: timestamp("created_at").notNull().default(sql`now()`),
  updated_at: timestamp("updated_at").notNull().default(sql`now()`)
});

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.user_id], references: [users.id] }),
  order_items: many(orderItems)
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.order_id], references: [orders.id] }),
  menu_item: one(menuItems, { fields: [orderItems.menu_item_id], references: [menuItems.id] })
}));