// Entry point: pick the language and load its dictionary first, then the app. Module-level strings in the app read
// the dictionary when they are evaluated, so main.js must be imported only after init() (see i18n.js).
import { init } from "./i18n.js";

await init();
await import("./main.js");
