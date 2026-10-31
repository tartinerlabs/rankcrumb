import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";

export async function GET() {
  await connection();
  const { rows } = await db.execute<{ now: string; version: string }>(
    sql`select now(), version()`,
  );
  return Response.json({ db: "ok", ...rows[0] });
}
