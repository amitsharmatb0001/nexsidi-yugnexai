import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export const config = {
  port: Number(process.env.PORT) || 3001,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  corsOrigin: required("CORS_ORIGIN"),
};
