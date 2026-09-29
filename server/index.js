import "dotenv/config";
import { createStore } from "./store.js";
import { createApp } from "./app.js";
import { bootstrapOwner } from "./bootstrap-owner.js";
const demo = process.env.DEMO_MODE !== "false";
if (
  !demo &&
  (!process.env.MONGODB_URI ||
    !process.env.SESSION_SECRET ||
    process.env.SESSION_SECRET.length < 32)
)
  throw new Error(
    "Live mode requires MONGODB_URI and SESSION_SECRET of at least 32 characters.",
  );
if (demo && process.env.NODE_ENV === "production")
  throw new Error("Demo mode must not run in production.");
const store = await createStore({ demo });
await bootstrapOwner(store, { demo });
const app = createApp({ store, demo });
if (process.env.NODE_ENV === "production") app.set("trust proxy", 1);
app.listen(process.env.PORT || 4000, demo ? "127.0.0.1" : "0.0.0.0", () =>
  console.log(
    `Forma API: http://127.0.0.1:${process.env.PORT || 4000} (${demo ? "demo" : "MongoDB"})`,
  ),
);
