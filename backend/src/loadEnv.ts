import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Must be imported before any module that reads process.env at load time.
// Railway/Render inject vars directly — these files only matter for local dev.
const envDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(envDir, ".env") });
dotenv.config({ path: path.join(envDir, ".env.local"), override: true });
