import { Router, Request, Response } from "express"
import { z } from "zod"
import crypto from "crypto"

const router = Router()

// In-memory OTP store — replace with DB/Redis in production
const otpStore = new Map<string, { otp: string; expires: number }>()

// In-memory user store — replace with real DB
const userStore = new Map<string, {
  id: string
  email: string
  name: string
  role: "tenant" | "landlord" | "agent"
}>()

// In-memory token store — replace with JWT in production
const tokenStore = new Map<string, string>() // token -> email

const loginSchema = z.object({
  email: z.string().email(),
})

const verifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
})

// POST /auth/login — request OTP
router.post("/login", (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email" })
    return
  }

  const { email } = parsed.data
  const otp = Math.floor(100000 + Math.random() * 900000).toString()
  const expires = Date.now() + 10 * 60 * 1000 // 10 minutes

  otpStore.set(email, { otp, expires })

  // In production, send OTP via email here
  // For now, log it so you can test
  console.log(`[auth] OTP for ${email}: ${otp}`)

  res.json({ message: "OTP sent to your email" })
})

// POST /auth/verify-otp — verify OTP and return token
router.post("/verify-otp", (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" })
    return
  }

  const { email, otp } = parsed.data
  const stored = otpStore.get(email)

  if (!stored) {
    res.status(401).json({ error: "No OTP requested for this email" })
    return
  }

  if (Date.now() > stored.expires) {
    otpStore.delete(email)
    res.status(401).json({ error: "OTP has expired" })
    return
  }

  if (stored.otp !== otp) {
    res.status(401).json({ error: "Invalid OTP" })
    return
  }

  // OTP valid — clean up
  otpStore.delete(email)

  // Get or create user
  let user = userStore.get(email)
  if (!user) {
    user = {
      id: crypto.randomUUID(),
      email,
      name: email.split("@")[0],
      role: "tenant", // default role — update based on your logic
    }
    userStore.set(email, user)
  }

  // Generate token
  const token = crypto.randomBytes(32).toString("hex")
  tokenStore.set(token, email)

  res.json({ token, user })
})

// POST /auth/logout
router.post("/logout", (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7)
    tokenStore.delete(token)
  }
  res.json({ message: "Logged out" })
})

export { tokenStore, userStore }
export default router