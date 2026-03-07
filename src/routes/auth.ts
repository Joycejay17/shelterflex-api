import { Router, type Request, type Response } from 'express'
import { AppError } from '../errors/AppError.js'
import { ErrorCode } from '../errors/errorCodes.js'
import { validate } from '../middleware/validate.js'
import { otpRequestRateLimit } from '../middleware/authRateLimit.js'
import { requestOtpSchema, verifyOtpSchema } from '../schemas/auth.js'
import { generateOtp, generateToken } from '../utils/tokens.js'
import { generateOtpSalt, hashOtp, verifyOtpHash } from '../utils/otp.js'
import { otpChallengeStore, sessionStore, userStore } from '../models/authStore.js'
import { authenticateToken, type AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const OTP_TTL_MS = 10 * 60 * 1000
const OTP_MAX_ATTEMPTS = 5

/**
 * POST /api/auth/request-otp
 * Body: { email }
 */
router.post(
  '/request-otp',
  validate(requestOtpSchema, 'body'),
  otpRequestRateLimit(),
  (req: Request, res: Response) => {
    const email = (req.body.email as string).toLowerCase()

    const otp = generateOtp()
    const salt = generateOtpSalt()
    const otpHash = hashOtp(otp, salt)
    const expiresAt = new Date(Date.now() + OTP_TTL_MS)

    otpChallengeStore.set({ email, otpHash, salt, expiresAt, attempts: 0 })

    // MVP: No email provider integrated. For development, log OTP.
    // Never persist plaintext OTP.
    console.log(`[auth] OTP for ${email}: ${otp}`)

    res.json({ message: 'OTP sent to your email' })
  },
)

/**
 * POST /api/auth/verify-otp
 * Body: { email, otp } -> { token }
 */
router.post(
  '/verify-otp',
  validate(verifyOtpSchema, 'body'),
  (req: Request, res: Response) => {
    const email = (req.body.email as string).toLowerCase()
    const otp = req.body.otp as string

    const challenge = otpChallengeStore.getByEmail(email)
    if (!challenge) {
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'No OTP requested for this email')
    }

    if (new Date() > challenge.expiresAt) {
      otpChallengeStore.deleteByEmail(email)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'OTP has expired')
    }

    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      otpChallengeStore.deleteByEmail(email)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
    }

    const ok = verifyOtpHash(otp, challenge.salt, challenge.otpHash)
    if (!ok) {
      challenge.attempts += 1
      otpChallengeStore.set(challenge)
      throw new AppError(ErrorCode.UNAUTHORIZED, 401, 'Invalid OTP')
    }

    otpChallengeStore.deleteByEmail(email)

    const user = userStore.getOrCreateByEmail(email)
    const token = generateToken()
    sessionStore.create(email, token)

    res.json({ token, user })
  },
)

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (token) {
    sessionStore.deleteByToken(token)
  }
  res.json({ message: 'Logged out' })
})

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response) => {
  res.json({ user: req.user })
})

export default router