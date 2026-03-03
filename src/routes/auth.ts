import { Router, Request, Response } from "express"
import { z } from "zod"
import { generateOtp, generateToken, generateId } from "../utils/tokens.js"

const router = Router()

const otpStore = new Map<string, { otp: string; expires: number }>()
const userStore = new Map<string, {
  id: string
  email: string
  name: string
  role: "tenant" | "landlord" | "agent"
}>()
const tokenStore = new Map<string, string>()

const loginSchema = z.object({
  email: z.string().email(),
})

const verifySchema = z.object({
  email: z.string().email(),
  otp: z.string().length(6),
})

router.post("/login", (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email" })
    return
  }

  const { email } = parsed.data
  const otp = generateOtp()
  const expires = Date.now() + 10 * 60 * 1000

  otpStore.set(email, { otp, expires })
  console.log(`[auth] OTP for ${email}: ${otp}`)

  res.json({ message: "OTP sent to your email" })
})

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

  otpStore.delete(email)

  let user = userStore.get(email)
  if (!user) {
    user = {
      id: generateId(),
      email,
      name: email.split("@")[0],
      role: "tenant",
    }
    userStore.set(email, user)
  }

  const token = generateToken()
  tokenStore.set(token, email)

  res.json({ token, user })
})

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