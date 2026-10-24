import express from "express";
import helmet from "helmet";
import cors from "cors";
import routes from "./routes/index";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

app.use(express.json());
app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/v1", routes);

// Error handling middleware should be registered last
app.use(errorHandler);

export default app;
