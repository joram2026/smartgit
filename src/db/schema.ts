// src/db/schema.ts
import { pgTable, serial, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Define the 'users' table
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Define the 'user_data' table
export const userData = pgTable('user_data', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  key: text('key').notNull(), // e.g. 'profile', 'water_history', 'meals', 'goals', 'saved_recipes'
  value: jsonb('value').notNull(), // Stores arbitrary JSON state
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Define relationships
export const usersRelations = relations(users, ({ many }) => ({
  data: many(userData),
}));

export const userDataRelations = relations(userData, ({ one }) => ({
  user: one(users, {
    fields: [userData.userId],
    references: [users.id],
  }),
}));
