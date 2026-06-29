import express from "express";
import helmet from "helmet";
import cors from "cors";
import { clerkMiddleware, requireAuth, getAuth } from "@clerk/express";
import authRoutes from "./routes/auth";
import taskRoutes from "./routes/tasks";

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:3000", credentials: true }));
app.use(clerkMiddleware());

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/tasks", taskRoutes);

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});