// src/db/users.ts
import { db } from './index.ts';
import { users, userData } from './schema.ts';
import { eq, and } from 'drizzle-orm';

/**
 * Gets an existing user by Firebase UID or creates a new one in PostgreSQL.
 */
export async function getOrCreateUser(uid: string, email: string) {
  try {
    // First, try to find the user
    const existing = await db.select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);

    if (existing.length > 0) {
      // Update email if it changed
      if (existing[0].email !== email) {
        const updated = await db.update(users)
          .set({ email })
          .where(eq(users.id, existing[0].id))
          .returning();
        return updated[0];
      }
      return existing[0];
    }

    // Insert new user
    const result = await db.insert(users)
      .values({
        uid,
        email,
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error("Failed to get or create user in PostgreSQL:", error);
    throw new Error("Failed to authenticate user profile in database.", { cause: error });
  }
}

/**
 * Synchronizes user state key-value pairs (e.g. settings, water intake, meal history) into PostgreSQL.
 */
export async function syncUserData(userId: number, key: string, value: any) {
  try {
    const existing = await db.select()
      .from(userData)
      .where(and(eq(userData.userId, userId), eq(userData.key, key)))
      .limit(1);

    if (existing.length > 0) {
      const updated = await db.update(userData)
        .set({ value, updatedAt: new Date() })
        .where(eq(userData.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      const inserted = await db.insert(userData)
        .values({ userId, key, value })
        .returning();
      return inserted[0];
    }
  } catch (error) {
    console.error(`Failed to sync user data for key "${key}":`, error);
    throw new Error("Database sync failed.", { cause: error });
  }
}

/**
 * Retrieves all stored key-value states for a given user from PostgreSQL.
 */
export async function getUserData(userId: number) {
  try {
    const results = await db.select()
      .from(userData)
      .where(eq(userData.userId, userId));
    
    // Map array into a convenient dictionary object: { [key]: value }
    const dataMap: Record<string, any> = {};
    for (const row of results) {
      dataMap[row.key] = row.value;
    }
    return dataMap;
  } catch (error) {
    console.error("Failed to retrieve user data:", error);
    throw new Error("Failed to load saved settings from database.", { cause: error });
  }
}
