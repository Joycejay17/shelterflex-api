import "dotenv/config"
import { createApp } from "./app.js"
import { env } from "./schemas/env.js"
import { createRequire } from "module"

const require = createRequire(import.meta.url)
const { version } = require("../package.json") as { version: string }

const app = createApp()

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})