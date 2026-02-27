import "dotenv/config"
import { createApp } from "./app.js"
import { env } from "./schemas/env.js"

const app = createApp()

app.listen(env.PORT, () => {
  console.log(`[backend] listening on http://localhost:${env.PORT}`)
})