import type { VercelConfig } from "@vercel/config/v1";

// Hobby plan allows daily crons only, so run one every 3 hours
export const config: VercelConfig = {
  crons: [0, 3, 6, 9, 12, 15, 18, 21].map((hour) => ({
    path: "/api/cron/ranks",
    schedule: `0 ${hour} * * *`,
  })),
};
