import "express-session";
import type { SafeUser } from "./app-types";

declare module "express-session" {
  interface SessionData {
    user?: SafeUser;
  }
}
