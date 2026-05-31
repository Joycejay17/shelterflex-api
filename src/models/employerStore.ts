import { randomUUID, timingSafeEqual } from 'node:crypto'
import {
  type CreateEmployerInput,
  type CreateSalaryDeductionInstructionInput,
  type Employer,
  type EmployerPublicView,
  type EmployerStatus,
  type SalaryDeductionInstruction,
} from './employer.js'
import { generateRandomSecretHex, sha256Hex } from '../utils/sha256.js'

const employers = new Map<string, Employer>()
const instructions = new Map<string, SalaryDeductionInstruction>()

function toPublicView(employer: Employer): EmployerPublicView {
  return {
    id: employer.id,
    name: employer.name,
    registrationNumber: employer.registrationNumber,
    contactEmail: employer.contactEmail,
    contactPhone: employer.contactPhone,
    status: employer.status,
    monthlyDeductionWebhookUrl: employer.monthlyDeductionWebhookUrl,
    verifiedAt: employer.verifiedAt?.toISOString(),
    createdAt: employer.createdAt.toISOString(),
  }
}

function instructionKey(employerId: string, employeeId: string): string {
  return `${employerId}:${employeeId}`
}

export function generateEmployerApiKey(): string {
  return `sk_employer_${generateRandomSecretHex(32)}`
}

export function hashEmployerApiKey(plainKey: string): string {
  return sha256Hex(plainKey)
}

export function verifyEmployerApiKey(plainKey: string, storedHash: string): boolean {
  const candidate = sha256Hex(plainKey)
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch {
    return false
  }
}

export const employerStore = {
  create(input: CreateEmployerInput): { employer: EmployerPublicView; apiKey: string } {
    const plainKey = generateEmployerApiKey()
    const employer: Employer = {
      id: randomUUID(),
      name: input.name.trim(),
      registrationNumber: input.registrationNumber.trim(),
      contactEmail: input.contactEmail.trim(),
      contactPhone: input.contactPhone.trim(),
      status: 'pending',
      apiKeyHash: hashEmployerApiKey(plainKey),
      monthlyDeductionWebhookUrl: input.monthlyDeductionWebhookUrl?.trim() || undefined,
      createdAt: new Date(),
    }
    employers.set(employer.id, employer)
    return { employer: toPublicView(employer), apiKey: plainKey }
  },

  findById(id: string): Employer | undefined {
    return employers.get(id)
  },

  findByApiKey(plainKey: string): Employer | undefined {
    for (const employer of employers.values()) {
      if (verifyEmployerApiKey(plainKey, employer.apiKeyHash)) {
        return employer
      }
    }
    return undefined
  },

  list(status?: EmployerStatus): EmployerPublicView[] {
    return Array.from(employers.values())
      .filter((e) => !status || e.status === status)
      .map(toPublicView)
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  searchActiveByName(query: string): { id: string; name: string }[] {
    const q = query.trim().toLowerCase()
    return Array.from(employers.values())
      .filter((e) => e.status === 'active' && (!q || e.name.toLowerCase().includes(q)))
      .map((e) => ({ id: e.id, name: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  },

  activate(id: string): EmployerPublicView | null {
    const employer = employers.get(id)
    if (!employer) return null
    employer.status = 'active'
    employer.verifiedAt = new Date()
    employers.set(id, employer)
    return toPublicView(employer)
  },

  createInstruction(input: CreateSalaryDeductionInstructionInput): SalaryDeductionInstruction {
    const instruction: SalaryDeductionInstruction = {
      dealId: input.dealId,
      employerId: input.employerId,
      employeeId: input.employeeId.trim(),
      deductionAmount: input.deductionAmount,
      deductionDay: input.deductionDay,
      createdAt: new Date(),
    }
    instructions.set(instructionKey(input.employerId, input.employeeId), instruction)
    return instruction
  },

  findInstruction(employerId: string, employeeId: string): SalaryDeductionInstruction | undefined {
    return instructions.get(instructionKey(employerId, employeeId.trim()))
  },

  findInstructionByDealId(dealId: string): SalaryDeductionInstruction | undefined {
    for (const instruction of instructions.values()) {
      if (instruction.dealId === dealId) return instruction
    }
    return undefined
  },

  listActiveInstructions(): SalaryDeductionInstruction[] {
    return Array.from(instructions.values())
  },

  deleteInstructionForDeal(dealId: string): void {
    for (const [key, instruction] of instructions.entries()) {
      if (instruction.dealId === dealId) {
        instructions.delete(key)
      }
    }
  },

  clear(): void {
    employers.clear()
    instructions.clear()
  },
}
