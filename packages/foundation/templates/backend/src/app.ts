import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config";
import { errorHandler, notFound } from "./middleware/errors";
import routes from "./routes/index";

const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
app.use("/api/v1", routes);
app.use(notFound);
app.use(errorHandler);

export default app;
