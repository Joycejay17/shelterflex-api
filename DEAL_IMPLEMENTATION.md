# Deal Model and Repayment Schedule Implementation

## Overview

This implementation provides a complete backend solution for ShelterFlex's financing deals with deterministic repayment schedule generation.

## Core Components

### 1. Domain Models (`src/models/deal.ts`)

**Deal Model:**
- `dealId`: UUID identifier
- `tenantId`: Tenant who repays the financing
- `landlordId`: Landlord who receives upfront payment
- `listingId`: Optional associated property listing
- `annualRentNgn`: Annual rent amount in Naira
- `depositNgn`: Deposit amount (must be >= 20% of annual rent)
- `financedAmountNgn`: Amount financed by ShelterFlex (annual rent - deposit)
- `termMonths`: Repayment term (3, 6, or 12 months)
- `createdAt`: Deal creation timestamp
- `status`: Deal status (draft, active, completed, defaulted)

**Schedule Item Model:**
- `period`: Payment period number (1-indexed)
- `dueDate`: ISO date when payment is due
- `amountNgn`: Payment amount in Naira
- `status`: Payment status (upcoming, due, paid, late)

### 2. Schedule Generator (`src/utils/scheduleGenerator.ts`)

**Deterministic Rounding Strategy:**
1. Calculate base monthly payment: `(annualRentNgn - depositNgn) / termMonths`
2. Apply standard rounding (2 decimal places) to all but final payment
3. Adjust final payment to account for rounding discrepancy
4. All payments start with 'upcoming' status

**Key Features:**
- Guaranteed total equals financed amount
- Consistent rounding across all deals
- Grace period support for status updates
- Balance calculation utilities

### 3. Data Store (`src/models/dealStore.ts`)

**In-memory store following existing patterns:**
- CRUD operations for deals
- Filtering by tenant, landlord, status
- Pagination support
- Schedule item status updates
- Business rule validation

**Validation Rules:**
- Deposit must be >= 20% of annual rent
- Annual rent must be > 0
- Term months must be 3, 6, or 12
- Deposit must be < annual rent

### 4. API Endpoints (`src/routes/deals.ts`)

**Available Endpoints:**
- `POST /api/deals` - Create new deal with schedule
- `GET /api/deals/:dealId` - Get specific deal with schedule
- `GET /api/deals` - List deals with filtering and pagination
- `PATCH /api/deals/:dealId/status` - Update deal status
- `PATCH /api/deals/:dealId/schedule/:period` - Update schedule item status

**Response Format:**
```json
{
  "success": true,
  "data": { /* deal or deal list */ }
}
```

**Error Handling:**
- Uses standard backend error format
- Proper HTTP status codes
- Validation error details

### 5. Validation Schemas (`src/schemas/deal.ts`)

**Zod schemas for:**
- Deal creation with business rule validation
- Deal filtering parameters
- Status update operations
- Schedule item updates

### 6. OpenAPI Documentation (`openapi.yml`)

**Complete API documentation including:**
- All Deal endpoints with examples
- Request/response schemas
- Parameter descriptions
- Error response formats
- Deal tag for organization

## Example Usage

### Creating a Deal
```bash
POST /api/deals
{
  "tenantId": "tenant-001",
  "landlordId": "landlord-001",
  "annualRentNgn": 1200000,
  "depositNgn": 240000,
  "termMonths": 12
}
```

### Response
```json
{
  "success": true,
  "data": {
    "dealId": "550e8400-e29b-41d4-a716-446655440000",
    "tenantId": "tenant-001",
    "landlordId": "landlord-001",
    "annualRentNgn": 1200000,
    "depositNgn": 240000,
    "financedAmountNgn": 960000,
    "termMonths": 12,
    "status": "draft",
    "createdAt": "2024-01-15T10:00:00Z",
    "schedule": [
      {
        "period": 1,
        "dueDate": "2024-02-15T00:00:00Z",
        "amountNgn": 80000,
        "status": "upcoming"
      },
      // ... 11 more payments
    ]
  }
}
```

## Testing

### Unit Tests (`src/routes/deals.test.ts`)
- Complete test coverage for all endpoints
- Validation rule testing
- Error handling verification
- Pagination and filtering tests

### Example Script (`examples/deal-example.js`)
- Demonstrates deal creation
- Shows rounding strategy
- Examples of filtering and retrieval
- Validation rule documentation

## Build and Quality

✅ **TypeScript compilation**: `npm run build`  
✅ **Linting**: `npm run lint`  
✅ **Type checking**: `npm run typecheck`  
✅ **OpenAPI documentation**: Updated with Deal schemas  
✅ **Deterministic schedule generation**: Documented rounding rules  
✅ **Standard error format**: Consistent with existing backend  

## Key Features Delivered

1. **Deterministic Schedule Generation**: Every deal with same parameters generates identical schedules
2. **Documented Rounding Strategy**: Clear rules for payment calculation and rounding
3. **Complete CRUD Operations**: Full deal lifecycle management
4. **Flexible Filtering**: Search by tenant, landlord, status with pagination
5. **Status Management**: Track deal and individual payment statuses
6. **Business Rule Validation**: Enforce deposit requirements and term constraints
7. **Comprehensive Testing**: Unit tests and working examples
8. **API Documentation**: Complete OpenAPI specification

## Future Enhancements

- Database persistence (currently in-memory)
- Payment processing integration
- Automated status updates based on dates
- Deal analytics and reporting
- Integration with property listings
- Notification systems for due payments
