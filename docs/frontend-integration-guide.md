# Frontend Integration Guide (Membership + QR)

This guide explains how to integrate your mobile/web app with the Strapi backend in this repo to support user signup, membership card, scanning QR at business locations to collect points, and redeeming rewards.

## Base Setup

- GraphQL endpoint: `http://<your-host>:1337/graphql`
- Auth: Bearer token in `Authorization` header after signup/login.
- Node/JS client recommended: Apollo Client (React/React Native) or any GraphQL client.

## Auth Flow

### Signup (Legends card is auto-created)

The backend exposes a custom `signup` mutation in `src/index.ts`. `phone_number` is required and a "Legends" MemberCard is auto-created on the server after signup. Fetch the card via `myCard` (see below) after you store the `jwt`.

```graphql
mutation Signup(
  $name: String
  $username: String!
  $email: String!
  $password: String!
  $phone_number: String!
) {
  signup(
    name: $name
    username: $username
    email: $email
    password: $password
    phone_number: $phone_number
  ) {
    ok
    jwt
    user {
      id
      username
      email
      phone_number
    }
  }
}
```

Store `jwt` securely (Keychain/Keystore). Use it on every request:

```text
Authorization: Bearer <jwt>
```

### Login (REST)

You can use Strapi Users & Permissions login via REST:

- POST `/api/auth/local`
- Body: `{ identifier: <email_or_username>, password: <password> }`
- Response: `{ jwt, user }`

Alternatively, you can add a GraphQL login mutation similarly to signup.

## GraphQL Operations

### Get member card, transactions, rewards, settings

```graphql
query MyStuff($limit: Int, $from: DateTime, $to: DateTime) {
  # myCard is returned as a JSON scalar (entire card object). No subfield selections here.
  myCard
  myTransactions(limit: $limit, from: $from, to: $to) {
    id
    pointsAwarded
    scannedAt
    location { id name }
  }
  rewards(activeOnly: true) {
    id
    title
    description
    costPoints
  }
  settings {
    defaultPointsPerScan
    perDay
    perWeek
    perMonth
  }
}
```

### Scan a location QR or enter code to add points

The app scans a QR at a business location. The QR image now encodes a short `entryCode` (human-friendly); users may also type this code manually. Submit the scanned/entered code:

```graphql
mutation Scan($code: String!) {
  scanQRCode(code: $code) {
    ok
    pointsAwarded
    balance
    limits {
      perDay
      perWeek
      perMonth
      todayCount
      weekCount
      monthCount
    }
  }
}
```

- Requires auth.
- Enforces daily/weekly/monthly limits from `Settings`.
- Returns updated balance and current window counters.

### Redeem a reward

```graphql
mutation Redeem($rewardId: ID!) {
  redeemReward(rewardId: $rewardId) {
    ok
    balance
    redemptionId
    status
  }
}
```

- Requires auth.
- Fails if balance < `costPoints` or reward is inactive.

## Client Code Examples (React/React Native)

### Apollo Client setup with JWT

```ts
import { ApolloClient, InMemoryCache, createHttpLink } from "@apollo/client";
import { setContext } from "@apollo/client/link/context";

const httpLink = createHttpLink({ uri: "http://<your-host>:1337/graphql" });

const authLink = setContext((_, { headers }) => {
  const token = /* read from secure storage */ "";
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : "",
    },
  };
});

export const apollo = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache(),
});
```

### Scan flow (simplified)

1. Use a QR scanner library (e.g., react-native-camera, ZXing, etc.) to get the QR content (the short `entryCode`).
2. Call the `scanQRCode` mutation with `{ code: scannedValue }`.
3. Alternatively, allow users to type the code manually and call `{ code: typedValue }`.
4. On success, update the UI with new balance and show points awarded.
5. On error, show rate-limit or invalid code message.

```ts
import { gql, useMutation } from "@apollo/client";

const SCAN = gql`
  mutation Scan($code: String!) {
    scanQRCode(code: $code) {
      ok
      pointsAwarded
      balance
      limits { perDay perWeek perMonth todayCount weekCount monthCount }
    }
  }
`;

export function useScan() {
  const [scan, state] = useMutation(SCAN);
  return {
    scanQRCode: (qrToken: string) => scan({ variables: { qrToken } }),
    ...state,
  };
}
```

### Signup (client example)

```ts
import { gql, useMutation } from "@apollo/client";

const SIGNUP = gql`
  mutation Signup(
    $name: String
    $username: String!
    $email: String!
    $password: String!
    $phone_number: String!
  ) {
    signup(
      name: $name
      username: $username
      email: $email
      password: $password
      phone_number: $phone_number
    ) {
      ok
      jwt
      user { id username email }
    }
  }
`;

export function useSignup() {
  const [signup, state] = useMutation(SIGNUP);
  return {
    signup: (vars: { name?: string; username: string; email: string; password: string; phone_number: string }) =>
      signup({ variables: vars }),
    ...state,
  };
}
```

### Get the card after signup

After you store the `jwt`, query `myCard` to render the user’s Legends card details:

```graphql
query MyCardAfterSignup {
  myCard
}
```

The `myCard` JSON typically includes fields like:

```json
{
  "id": "<id>",
  "cardNumber": "LEG-ABCDEFGH",
  "pointsBalance": 0,
  "status": "active",
  "tier": "Legends",
  "issuedAt": "2025-09-15T12:00:00.000Z"
}
```

## Error Handling

- Rate-limits: `scanQRCode` throws e.g., "Daily scan limit reached". Display clearly and prevent retry spam.
- Invalid QR: "Invalid or inactive location QR" if the QR token doesn’t map to an active Location.
- Auth errors: If `jwt` missing/expired, GraphQL returns auth errors. Redirect to login.

## Admin/Backoffice Notes

- When a Location is saved in Strapi Admin, `qrToken` is ensured and a QR image is generated and linked to `qrImage` automatically.
- Admin can view and print/download the QR image for in-store display.
- Admin can adjust `Settings` singleton fields to change points per scan and scan frequency limits.
- Admin manages `Reward` catalog; users can redeem via `redeemReward`.

## Environments & Security

- Use environment-specific GraphQL URL.
- Store JWT in AsyncStorage (as per your app). Note: AsyncStorage is not secure; for production security consider Keychain/Keystore.
- Consider adding minimal client-side caching of `myCard` and `rewards` to improve UX.

## Smoke Test Checklist

- [ ] Signup a new user → Legends card present in response
- [ ] Create a Location in Admin → QR image auto-generated
- [ ] Scan the QR in app → points increment, limits enforced
- [ ] List rewards → redeem one with sufficient points
- [ ] Adjust Settings → verify new limits/points apply on next scan

---

## React Native CLI Quickstart (Copy/Paste Ready)

### Install client-side dependencies

```bash
# Scanner (choose one)
# Option A (simpler API):
yarn add react-native-camera
cd ios && pod install && cd ..

# Option B (modern, more configuration):
# yarn add react-native-vision-camera
# cd ios && pod install && cd ..
# Follow vision-camera permissions setup in their README
```

### Apollo

Your app already has `@apollo/client` configured. Ensure your auth link reads the JWT from AsyncStorage and sets `Authorization: Bearer <jwt>`.

### Save/Read JWT with AsyncStorage

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function saveJwt(jwt: string) {
  await AsyncStorage.setItem("jwt", jwt);
}

export async function getJwt() {
  return AsyncStorage.getItem("jwt");
}
```

### Signup screen (minimal)

```ts
import { gql, useMutation } from "@apollo/client";
import { saveJwt } from "../auth/jwt";

const SIGNUP = gql`
  mutation Signup($username: String!, $email: String!, $password: String!, $phone_number: String!, $name: String) {
    signup(username: $username, email: $email, password: $password, phone_number: $phone_number, name: $name) {
      ok
      jwt
      user { id username email }
    }
  }
`;

export function useSignup() {
  const [mutate, state] = useMutation(SIGNUP);
  return {
    signup: async (vars: { username: string; email: string; password: string; phone_number: string; name?: string }) => {
      const res = await mutate({ variables: vars });
      const jwt = res.data?.signup?.jwt;
      if (jwt) await saveJwt(jwt);
      return res;
    },
    ...state,
  };
}
```

### Scan screen with react-native-camera

```tsx
import React, { useEffect, useState } from "react";
import { Text, View, Button, Platform, PermissionsAndroid } from "react-native";
import { RNCamera, BarCodeReadEvent } from "react-native-camera";
import { gql, useMutation } from "@apollo/client";

const SCAN = gql`
  mutation Scan($qrToken: String!) {
    scanQRCode(qrToken: $qrToken) {
      ok
      pointsAwarded
      balance
      limits { perDay perWeek perMonth todayCount weekCount monthCount }
    }
  }
`;

export default function ScanScreen() {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanQR] = useMutation(SCAN);

  useEffect(() => {
    (async () => {
      if (Platform.OS === "android") {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );
        setHasPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
      } else {
        setHasPermission(true);
      }
    })();
  }, []);

  if (hasPermission === null) return <Text>Requesting camera permission...</Text>;
  if (hasPermission === false) return <Text>No access to camera</Text>;

  const onBarCodeRead = async (e: BarCodeReadEvent) => {
    try {
      const code = e.data; // entryCode from QR
      await scanQR({ variables: { code } });
      // Show success and update balance UI
    } catch (err: any) {
      // Show error: err.message (rate limit or invalid code)
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <RNCamera
        style={{ flex: 1 }}
        type={RNCamera.Constants.Type.back}
        captureAudio={false}
        onBarCodeRead={onBarCodeRead}
      />
      <Button title="Scan Again" onPress={() => { /* reset any state if needed */ }} />
    </View>
  );
}
```

### Fetch card and transactions

```ts
import { gql, useQuery } from "@apollo/client";

export const MY_STUFF = gql`
  query MyStuff($limit: Int) {
    myCard
    myTransactions(limit: $limit) { id pointsAwarded scannedAt location { id name } }
    rewards(activeOnly: true) { id title costPoints }
    settings { defaultPointsPerScan perDay perWeek perMonth }
  }
`;

export function useMyStuff(limit = 20) {
  return useQuery(MY_STUFF, { variables: { limit } });
}
```

### Redeem reward

```ts
import { gql, useMutation } from "@apollo/client";

const REDEEM = gql`
  mutation Redeem($rewardId: ID!) {
    redeemReward(rewardId: $rewardId) { ok balance redemptionId status }
  }
`;

export function useRedeem() {
  const [redeem, state] = useMutation(REDEEM);
  return { redeem, ...state };
}
```

### UX tips

- Always send `Authorization: Bearer <jwt>` — the Apollo link above does this automatically.
- After signup/login, call `myCard` to render the Legends card.
- Handle errors from `scanQRCode` gracefully (daily/weekly/monthly limit messages).
- Consider caching `myCard` and `rewards` in state for fast UI.
