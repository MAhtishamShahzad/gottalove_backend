# Membership QR System – Implementation Checklist

This document lists all tasks required to deliver the membership card + QR scanning system using Strapi (GraphQL) in this repository. Work through each section top-to-bottom. Check off items as you complete them.

Legend: [ ] pending, [x] done

## 1) Content-types: Core Entities

- [ ] MemberCard – `src/api/member-card/content-types/member-card/schema.json`
  - [ ] Fields
    - [ ] `user` oneToOne → `plugin::users-permissions.user` (required, unique)
    - [ ] `cardNumber` string (required, unique)
    - [ ] `pointsBalance` integer (default 0)
    - [ ] `status` enum [active, suspended] (default active)
    - [ ] `tier` enum [Legends] (default Legends)
    - [ ] `issuedAt` datetime
  - [ ] Acceptance: Can create/edit MemberCard in admin; unique `cardNumber` enforced.

- [ ] Location – `src/api/location/content-types/location/schema.json`
  - [ ] Fields
    - [ ] `name` string (required)
    - [ ] `address` string
    - [ ] `isActive` boolean (default true)
    - [ ] `qrToken` string (private)
    - [ ] `qrImage` media single
  - [ ] Acceptance: Creating a Location auto-populates `qrImage` (see Task 2).

- [ ] ScanEvent – `src/api/scan-event/content-types/scan-event/schema.json`
  - [ ] Fields
    - [ ] `user` manyToOne → `plugin::users-permissions.user` (required)
    - [ ] `location` manyToOne → `api::location.location` (required)
    - [ ] `pointsAwarded` integer (required)
    - [ ] `scannedAt` datetime (default now)
    - [ ] `qrTokenId`/`nonce` string (optional; for anti-replay later)
  - [ ] Acceptance: Created automatically on successful scan mutation.

- [ ] Reward – `src/api/reward/content-types/reward/schema.json`
  - [ ] Fields
    - [ ] `title` string (required)
    - [ ] `description` text
    - [ ] `costPoints` integer (required)
    - [ ] `active` boolean (default true)
    - [ ] `inventory` integer (optional)
  - [ ] Acceptance: Rewards manageable via admin.

- [ ] Redemption – `src/api/redemption/content-types/redemption/schema.json`
  - [ ] Fields
    - [ ] `user` manyToOne → `plugin::users-permissions.user` (required)
    - [ ] `reward` manyToOne → `api::reward.reward` (required)
    - [ ] `pointsSpent` integer (required)
    - [ ] `status` enum [pending, approved, rejected] (pick default)
    - [ ] `redeemedAt` datetime
  - [ ] Acceptance: Created by redeem mutation; points deducted from member.

- [ ] Settings (singleton) – `src/api/settings/content-types/settings/schema.json`
  - [ ] Fields
    - [ ] `defaultPointsPerScan` integer (default 1)
    - [ ] `perDay` integer (default 1)
    - [ ] `perWeek` integer (default 3)
    - [ ] `perMonth` integer (default 10)
    - [ ] `perLocationOverrides` JSON (optional)
  - [ ] Acceptance: Admin can set points per scan and daily/weekly/monthly limits.

## 2) QR Generation on Save (Location Lifecycle)

- [ ] Add dependency in `package.json`: `"qrcode": "^1.5.4"`
- [ ] Implement lifecycle – `src/api/location/content-types/location/lifecycles.ts`
  - [ ] `beforeCreate`:
    - [ ] Ensure `qrToken` exists (generate random if missing)
    - [ ] Generate QR PNG buffer from `qrToken`
    - [ ] Upload via Upload plugin
    - [ ] Assign uploaded image id to `qrImage`
  - [ ] `beforeUpdate`:
    - [ ] If `qrToken` changed or `qrImage` missing → re-generate and upload
  - [ ] Acceptance: Saving a Location auto-attaches a QR image; Admin sees the image.

## 3) Auto-create “Legends” Card at Signup

- [ ] Extend GraphQL `signup` resolver – `src/index.ts`
  - [ ] After user creation, create `api::member-card.member-card` if missing
  - [ ] Defaults:
    - [ ] `cardNumber` → `LEG-XXXXXXXX` (random 8-hex)
    - [ ] `pointsBalance` → 0
    - [ ] `status` → `active`
    - [ ] `tier` → `Legends`
    - [ ] `issuedAt` → now
  - [ ] Include `memberCard` in `SignupPayload.user`
  - [ ] Acceptance: After signup, response includes user with a Legends card.

## 4) GraphQL API – Types, Queries, Mutations

- [ ] Types in `src/index.ts`:
  - [ ] `MemberCard`, `ScanEvent`, `Reward`, `Redemption`, `Settings`
  - [ ] `LimitsSummary` { `perDay`, `perWeek`, `perMonth`, `todayCount`, `weekCount`, `monthCount` }
- [ ] Queries (auth: true):
  - [ ] `myCard(): MemberCard`
  - [ ] `myTransactions(limit, from, to): [ScanEvent]`
  - [ ] `rewards(activeOnly): [Reward]`
  - [ ] `settings(): Settings` (optional admin-only)
- [ ] Mutations:
  - [ ] `scanQRCode(qrToken: String!): { ok, pointsAwarded, balance, limits }` (auth: true)
    - [ ] Resolve `qrToken` → `Location` (must be `isActive`)
    - [ ] Load `Settings` (+ per-location override if exists)
    - [ ] Count user scans for day/week/month windows
    - [ ] Enforce limits; deny with message if exceeded
    - [ ] Create `ScanEvent` and increment `MemberCard.pointsBalance`
  - [ ] `redeemReward(rewardId: ID!): { ok, balance, redemption { id status } }` (auth: true)
    - [ ] Validate `Reward` (active, inventory if used)
    - [ ] Ensure balance ≥ `costPoints`
    - [ ] Create `Redemption`; decrement balance (and inventory if used)
  - [ ] `adminRotateLocationQR(locationId: ID!): { ok }` (admin-only)
    - [ ] Set new `qrToken` (lifecycle regenerates `qrImage`)
- [ ] `resolversConfig` permissions:
  - [ ] Authenticated: `myCard`, `myTransactions`, `rewards`, `scanQRCode`, `redeemReward`
  - [ ] Admin: `adminRotateLocationQR` and settings management
- [ ] Acceptance: All operations available and permissioned correctly.

## 5) Rate Limiting Logic

- [ ] Implement in `scanQRCode` resolver:
  - [ ] Determine `startOfDay`, `startOfWeek`, `startOfMonth`
  - [ ] Count `ScanEvent` for the user in each window
  - [ ] Compare to `Settings.perDay`, `perWeek`, `perMonth` (or per-location override)
  - [ ] If exceeded → return error; else award `defaultPointsPerScan` (or override)
- [ ] Acceptance: Repeated scans respect daily/weekly/monthly limits.

## 6) Security & Permissions

- [ ] Users & Permissions plugin
  - [ ] Public: none of the scan/redeem/member endpoints
  - [ ] Authenticated: scanning and redeeming endpoints
  - [ ] Admin: manage `Location`, `Settings`, `Reward`, `Redemption`, rotate QR
- [ ] Optional anti-replay (future):
  - [ ] Use short-lived JWT QR with `nonce`; reject duplicates within TTL
- [ ] Acceptance: Only members can scan/redeem; admins manage configuration.

## 7) Bootstrap Defaults

- [ ] In `src/index.ts` → `bootstrap()`:
  - [ ] Create the `Settings` singleton if missing with sensible defaults
- [ ] Acceptance: First boot has default limits and points per scan.

## 8) DB Indexes (Optional, Recommended)

- [ ] Add indexes for `ScanEvent`:
  - [ ] `(user, scannedAt)`
  - [ ] `(location, scannedAt)`
- [ ] Acceptance: Scan counting is efficient.

## 9) Testing

- [ ] Manual tests (GraphQL):
  - [ ] Signup → returns user with Legends `memberCard`
  - [ ] Create `Location` → `qrImage` auto-generated
  - [ ] `scanQRCode` → balance increments, `ScanEvent` created, limits enforced
  - [ ] `redeemReward` → points deducted, `Redemption` created
- [ ] Optional automated tests (Jest):
  - [ ] Resolvers unit tests
  - [ ] Lifecycle tests for QR generation

## 10) Build & Run

- [ ] Node version 18–22.x (per `package.json` engines)
- [ ] `yarn`
- [ ] Dev: `yarn dev`
- [ ] Prod: `yarn build && yarn start`
- [ ] Acceptance: App boots and new features are functional.

---

## Notes
- The `signup` GraphQL mutation in `src/index.ts` should already enforce `phone_number: String!` and now also auto-creates a Legends MemberCard and returns it in `SignupPayload.user`.
- The Location lifecycle generates and stores the QR image automatically on save, so admins don’t need to upload it manually.
