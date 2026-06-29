import { boolean, pgTable, relations, sql, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";


export const users = pgTable("users", {
  id: uuid()("id").primaryKey().default(sql`gen_random_uuid()`),
  clerk_id: varchar(36)("clerk_id").notNull().unique(),
  email: varchar(255)("email").notNull().unique(),
  created_at: timestamp({ withTimezone: true })("created_at").notNull().default(sql`now()`),
  updated_at: timestamp({ withTimezone: true })("updated_at").notNull().default(sql`now()`)
}, (table) => ({
  users_clerk_id_idx,
  users_email_idx
}));

export const tasks = pgTable("tasks", {
  id: uuid()("id").primaryKey().default(sql`gen_random_uuid()`),
  user_id: uuid()("user_id").notNull().references(() => users.id),
  title: varchar(255)("title").notNull(),
  description: text()("description"),
  due_date: timestamp({ withTimezone: true })("due_date").notNull(),
  is_completed: boolean()("is_completed").notNull().default(false),
  created_at: timestamp({ withTimezone: true })("created_at").notNull().default(sql`now()`),
  updated_at: timestamp({ withTimezone: true })("updated_at").notNull().default(sql`now()`)
}, (table) => ({
  tasks_user_id_idx,
  tasks_due_date_idx,
  tasks_is_completed_idx
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  user: one(users, { fields: [tasks.user_id], references: [users.id] })
}));