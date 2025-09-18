import type { Core } from "@strapi/strapi";

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }: { strapi: Core.Strapi }) {
    // Extend GraphQL schema with OTP mutations
    const extensionService: any = strapi.service("plugin::graphql.extension");
    extensionService.use(() => ({
      typeDefs: /* GraphQL */ `
        type OTPRequestPayload {
          ok: Boolean!
        }

        type VerifyOTPPayload {
          ok: Boolean!
          jwt: String
          userId: ID
          user: SignupUser
        }

        type ForgotPasswordConfirmPayload {
          ok: Boolean!
        }

        type SignupUser {
          id: ID!
          email: String!
          username: String!
          name: String
          confirmed: Boolean
          blocked: Boolean
          documentId: ID!
          phone_number: String
        }

        type SignupPayload {
          ok: Boolean!
          jwt: String
          user: SignupUser
        }

        type Location {
          id: ID!
          name: String!
        }

        type ScanEvent {
          id: ID!
          pointsAwarded: Int!
          scannedAt: DateTime
          location: Location
        }

        type Reward {
          id: ID!
          title: String!
          description: String
          costPoints: Int!
          active: Boolean
        }

        type Settings {
          id: ID!
          defaultPointsPerScan: Int!
          perDay: Int!
          perWeek: Int!
          perMonth: Int!
        }

        type LimitsSummary {
          perDay: Int!
          perWeek: Int!
          perMonth: Int!
          todayCount: Int!
          weekCount: Int!
          monthCount: Int!
        }

        type ScanResult {
          ok: Boolean!
          pointsAwarded: Int
          balance: Int
          limits: LimitsSummary
        }

        type RedeemPayload {
          ok: Boolean!
          balance: Int
          redemptionId: ID
          status: String
        }

        """
        Member card type representing loyalty card data.
        """
        type MemberCard {
          id: ID!
          documentId: ID
          cardNumber: String!
          pointsBalance: Int
          card_status: String
          status: String
          tier: String
          issuedAt: DateTime
          createdAt: DateTime
          updatedAt: DateTime
          publishedAt: DateTime
          locale: String
        }

        # Extend built-in UsersPermissionsUser to expose documentId
        extend type UsersPermissionsUser {
          documentId: ID
        }

        extend type Query {
          usernameExists(username: String!): Boolean!
          myCard: JSON
          myTransactions(limit: Int, from: DateTime, to: DateTime): [ScanEvent]
          rewards(activeOnly: Boolean): [Reward]
          settings: Settings
        }

        extend type Mutation {
          requestEmailOTP(email: String!): OTPRequestPayload
          verifyEmailOTP(email: String!, code: String!): VerifyOTPPayload
          forgotPasswordConfirm(
            email: String!
            code: String!
            newPassword: String!
          ): ForgotPasswordConfirmPayload
          signup(
            name: String
            username: String!
            email: String!
            password: String!
            phone_number: String!
          ): SignupPayload
          scanQRCode(qrToken: String!): ScanResult
          redeemReward(rewardId: ID!): RedeemPayload
          ensureMyCard: MemberCard
        }
      `,
      resolvers: {
        Query: {
          usernameExists: {
            resolve: async (_: unknown, args: { username: string }) => {
              const username = args.username?.trim();
              if (!username) return false;

              const existing = await strapi
                .documents("plugin::users-permissions.user")
                .findFirst({ filters: { username: { $eq: username } } });

              return !!existing;
            },
          },
          myCard: {
            resolve: async (_: unknown, _args: unknown, ctx: any) => {
              const userId = ctx?.state?.user?.id;
              if (!userId) throw new Error("Unauthorized");
              const cards = await (strapi as any).entityService.findMany(
                "api::member-card.member-card",
                { filters: { user: { id: { $eq: userId } } }, limit: 1 }
              );
              return Array.isArray(cards) ? cards[0] : cards;
            },
          },
          myTransactions: {
            resolve: async (
              _: unknown,
              args: { limit?: number; from?: string; to?: string },
              ctx: any
            ) => {
              const userId = ctx?.state?.user?.id;
              if (!userId) throw new Error("Unauthorized");
              const filters: any = { user: { id: { $eq: userId } } };
              if (args?.from || args?.to) {
                filters.scannedAt = {};
                if (args.from) filters.scannedAt.$gte = args.from;
                if (args.to) filters.scannedAt.$lte = args.to;
              }
              return (strapi as any).entityService.findMany(
                "api::scan-event.scan-event",
                {
                  filters,
                  sort: { scannedAt: "DESC" },
                  limit: args?.limit ?? 20,
                  populate: { location: true },
                }
              );
            },
          },
          rewards: {
            resolve: async (_: unknown, args: { activeOnly?: boolean }) => {
              const filters: any = {};
              if (args?.activeOnly) filters.active = { $eq: true };
              return (strapi as any).entityService.findMany(
                "api::reward.reward",
                { filters }
              );
            },
          },
          settings: {
            resolve: async () => {
              const items = await (strapi as any).entityService.findMany(
                "api::app-setting.app-setting",
                {}
              );
              return Array.isArray(items) ? items[0] : items;
            },
          },
        },
        Mutation: {
          requestEmailOTP: {
            resolve: async (_: unknown, args: { email: string }) => {
              const email = args.email?.trim().toLowerCase();
              if (!email) throw new Error("Email is required");

              const user = await strapi
                .documents("plugin::users-permissions.user")
                .findFirst({ filters: { email: { $eq: email } } });

              if (!user) {
                throw new Error("User not found");
              }

              const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
              const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

              await strapi.documents("plugin::users-permissions.user").update({
                documentId: user.documentId,

                data: {
                  otpCode: code,
                  otpExpiresAt: expiresAt,
                },
              });

              const subject = "Your verification code";
              const text = `Your one-time password is ${code}. It expires in 5 minutes.`;
              try {
                const emailService = strapi.service("plugin::email.email");
                await emailService.send(
                  { to: email, subject, text },
                  {
                    from: process.env.EMAIL_DEFAULT_FROM,
                    replyTo: process.env.EMAIL_DEFAULT_REPLY_TO,
                  }
                );
              } catch (e) {
                // Roll forward: do not expose internal error details
                throw new Error("Failed to send OTP email");
              }

              return { ok: true };
            },
          },
          verifyEmailOTP: {
            resolve: async (
              _: unknown,
              args: { email: string; code: string }
            ) => {
              const email = args.email?.trim().toLowerCase();
              const code = args.code?.trim();
              if (!email || !code)
                throw new Error("Email and code are required");

              const user = await strapi
                .documents("plugin::users-permissions.user")
                .findFirst({ filters: { email: { $eq: email } } });

              if (!user || !user.otpCode || !user.otpExpiresAt) {
                throw new Error("Invalid or expired code");
              }

              const now = new Date();
              const exp = new Date(user.otpExpiresAt);
              const isExpired = now.getTime() > exp.getTime();
              const isMatch = String(user.otpCode) === code;
              if (!isMatch || isExpired) {
                throw new Error("Invalid or expired code");
              }

              // Clear OTP and mark confirmed
              await strapi.documents("plugin::users-permissions.user").update({
                documentId: user.documentId,
                data: {
                  otpCode: null,
                  otpExpiresAt: null,
                  confirmed: true,
                },
              });

              // Re-fetch user to get updated data and documentId consistently
              const fresh = await strapi
                .documents("plugin::users-permissions.user")
                .findFirst({ filters: { id: { $eq: user.id } } });

              // Issue JWT
              const jwtService: any = strapi.service(
                "plugin::users-permissions.jwt"
              );
              const jwt = await jwtService.issue({ id: user.id });

              return {
                ok: true,
                jwt,
                userId: user.id,
                user: {
                  id: fresh?.id ?? user.id,
                  documentId: fresh?.documentId ?? user.documentId,
                  email: fresh?.email ?? user.email,
                  username: fresh?.username ?? user.username,
                  name: fresh?.name ?? user.name,
                  confirmed: fresh?.confirmed ?? true,
                  blocked: fresh?.blocked ?? user.blocked ?? false,
                },
              };
            },
          },
          forgotPasswordConfirm: {
            resolve: async (
              _: unknown,
              args: { email: string; code: string; newPassword: string }
            ) => {
              const email = args.email?.trim().toLowerCase();
              const code = args.code?.trim();
              const newPassword = args.newPassword;
              if (!email || !code || !newPassword) {
                throw new Error("Email, code and newPassword are required");
              }

              const user = await strapi
                .documents("plugin::users-permissions.user")
                .findFirst({ filters: { email: { $eq: email } } });

              if (!user || !user.otpCode || !user.otpExpiresAt) {
                throw new Error("Invalid or expired code");
              }

              const now = new Date();
              const exp = new Date(user.otpExpiresAt);
              const isExpired = now.getTime() > exp.getTime();
              const isMatch = String(user.otpCode) === code;
              if (!isMatch || isExpired) {
                throw new Error("Invalid or expired code");
              }

              // Update password using entityService to leverage hashing hooks
              await strapi.documents("plugin::users-permissions.user").update({
                documentId: user.documentId,
                data: {
                  password: newPassword,
                  otpCode: null,
                  otpExpiresAt: null,
                },
              });

              return { ok: true };
            },
          },
          signup: {
            resolve: async (
              _: unknown,
              args: {
                name?: string;
                username: string;
                email: string;
                password: string;
                phone_number: string;
              }
            ) => {
              const email = args.email?.trim().toLowerCase();
              const username = args.username?.trim();
              const name = args.name?.trim();
              const password = args.password;
              const phone_number = args.phone_number?.trim();
              if (!email || !username || !password || !phone_number) {
                throw new Error(
                  "email, username, password and phone_number are required"
                );
              }

              // Ensure email/username not taken
              const existingByEmail = await strapi
                .documents("plugin::users-permissions.user")
                .findFirst({ filters: { email: { $eq: email } } });
              if (existingByEmail) {
                throw new Error("Email already in use");
              }
              const existingByUsername = await strapi
                .documents("plugin::users-permissions.user")
                .findFirst({ filters: { username: { $eq: username } } });
              if (existingByUsername) {
                throw new Error("Username already in use");
              }

              // Get default authenticated role
              const authRole = await strapi
                .documents("plugin::users-permissions.role")
                .findFirst({ filters: { type: { $eq: "authenticated" } } });

              // Create user with entityService to hash password
              const created = await strapi.entityService.create(
                "plugin::users-permissions.user",
                {
                  data: {
                    email,
                    username,
                    name,
                    provider: "local",
                    password,
                    confirmed: false,
                    blocked: false,
                    phone_number,
                    ...(authRole?.id ? { role: authRole.id } : {}),
                  },
                }
              );

              // Issue JWT
              const jwtService: any = strapi.service(
                "plugin::users-permissions.jwt"
              );
              const jwt = await jwtService.issue({ id: created.id });

              // Auto-create Legends MemberCard with defaults if missing
              try {
                const existingCards = await (
                  strapi as any
                ).entityService.findMany("api::member-card.member-card", {
                  filters: {
                    user: { documentId: { $eq: created.documentId } },
                  },
                  limit: 1,
                });
                let card = Array.isArray(existingCards)
                  ? existingCards[0]
                  : existingCards;
                if (!card) {
                  const rnd = Math.random()
                    .toString(16)
                    .slice(2, 10)
                    .toUpperCase();
                  card = await (strapi as any).entityService.create(
                    "api::member-card.member-card",
                    {
                      data: {
                        user: created.documentId,
                        cardNumber: `LEG-${rnd}`,
                        pointsBalance: 0,
                        status: "active",
                        tier: "Legends",
                        issuedAt: new Date(),
                      },
                    }
                  );
                }
              } catch (e) {
                // Non-fatal: user created, but card creation failed
                strapi.log.warn(
                  `MemberCard auto-create failed: ${e?.message ?? e}`
                );
              }

              return {
                ok: true,
                jwt,
                user: {
                  id: created.id,
                  documentId: created.documentId,
                  email: created.email,
                  username: created.username,
                  name: created.name,
                  phone_number: created.phone_number,
                  confirmed: created.confirmed,
                  blocked: created.blocked,
                },
              };
            },
          },
          scanQRCode: {
            resolve: async (
              _: unknown,
              args: { qrToken: string },
              ctx: any
            ) => {
              const userId = ctx?.state?.user?.id;
              if (!userId) throw new Error("Unauthorized");

              const locationRes = await (strapi as any).entityService.findMany(
                "api::location.location",
                {
                  filters: {
                    qrToken: { $eq: args.qrToken },
                    isActive: { $eq: true },
                  },
                  limit: 1,
                }
              );
              const loc = Array.isArray(locationRes)
                ? locationRes[0]
                : locationRes;
              if (!loc) throw new Error("Invalid or inactive location QR");

              const settingsArr = await (strapi as any).entityService.findMany(
                "api::app-setting.app-setting",
                {}
              );
              const settings = Array.isArray(settingsArr)
                ? settingsArr[0]
                : settingsArr;
              const pointsPerScan: number = settings?.defaultPointsPerScan ?? 1;
              const perDay: number = settings?.perDay ?? 1;
              const perWeek: number = settings?.perWeek ?? 3;
              const perMonth: number = settings?.perMonth ?? 10;

              const now = new Date();
              const startOfDay = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate()
              );
              const dayOfWeek = (now.getDay() + 6) % 7;
              const startOfWeek = new Date(startOfDay);
              startOfWeek.setDate(startOfWeek.getDate() - dayOfWeek);
              const startOfMonth = new Date(
                now.getFullYear(),
                now.getMonth(),
                1
              );

              const countInWindow = async (from: Date) => {
                const res = await (strapi as any).entityService.findMany(
                  "api::scan-event.scan-event",
                  {
                    filters: {
                      user: { id: { $eq: userId } },
                      scannedAt: { $gte: from.toISOString() },
                    },
                    limit: 0,
                  }
                );
                return Array.isArray(res) ? res.length : 0;
              };

              const todayCount = await countInWindow(startOfDay);
              const weekCount = await countInWindow(startOfWeek);
              const monthCount = await countInWindow(startOfMonth);

              if (todayCount >= perDay)
                throw new Error("Daily scan limit reached");
              if (weekCount >= perWeek)
                throw new Error("Weekly scan limit reached");
              if (monthCount >= perMonth)
                throw new Error("Monthly scan limit reached");

              // ensure card exists (prefer documentId relation)
              let userDoc: any = null;
              try {
                userDoc = await strapi
                  .documents("plugin::users-permissions.user")
                  .findFirst({ filters: { id: { $eq: userId } } });
              } catch (e) {}

              const userDocumentId = userDoc?.documentId;

              let cards = await (strapi as any).entityService.findMany(
                "api::member-card.member-card",
                {
                  filters: userDocumentId
                    ? { user: { documentId: { $eq: userDocumentId } } }
                    : { user: { id: { $eq: userId } } },
                  limit: 1,
                }
              );
              let card = Array.isArray(cards) ? cards[0] : cards;
              if (!card && userDocumentId) {
                const byIdFallback = await (
                  strapi as any
                ).entityService.findMany("api::member-card.member-card", {
                  filters: { user: { id: { $eq: userId } } },
                  limit: 1,
                });
                card = Array.isArray(byIdFallback)
                  ? byIdFallback[0]
                  : byIdFallback;
              }

              if (!card) {
                const generateUniqueCardNumber = async (): Promise<string> => {
                  const maxAttempts = 10;
                  for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    const rnd = Math.random()
                      .toString(16)
                      .slice(2, 10)
                      .toUpperCase();
                    const candidate = `LEG-${rnd}`;
                    const existing = await (
                      strapi as any
                    ).entityService.findMany("api::member-card.member-card", {
                      filters: { cardNumber: { $eq: candidate } },
                      limit: 1,
                    });
                    const exists = Array.isArray(existing)
                      ? existing.length > 0
                      : Boolean(existing);
                    if (!exists) return candidate;
                  }
                  throw new Error(
                    "Failed to generate unique card number. Please try again."
                  );
                };

                const cardNumber = await generateUniqueCardNumber();
                const userRelation = userDocumentId ?? userId;
                card = await (strapi as any).entityService.create(
                  "api::member-card.member-card",
                  {
                    data: {
                      user: userRelation,
                      cardNumber,
                      pointsBalance: 0,
                      status: "active",
                      tier: "Legends",
                      issuedAt: new Date(),
                    },
                  }
                );
              }

              await (strapi as any).entityService.create(
                "api::scan-event.scan-event",
                {
                  data: {
                    user: userId,
                    location: loc.id,
                    pointsAwarded: pointsPerScan,
                    scannedAt: new Date(),
                  },
                }
              );

              const newBalance = (card.pointsBalance ?? 0) + pointsPerScan;
              await (strapi as any).entityService.update(
                "api::member-card.member-card",
                card.id,
                { data: { pointsBalance: newBalance } }
              );

              return {
                ok: true,
                pointsAwarded: pointsPerScan,
                balance: newBalance,
                limits: {
                  perDay,
                  perWeek,
                  perMonth,
                  todayCount: todayCount + 1,
                  weekCount: weekCount + 1,
                  monthCount: monthCount + 1,
                },
              };
            },
          },
          redeemReward: {
            resolve: async (
              _: unknown,
              args: { rewardId: string },
              ctx: any
            ) => {
              const userId = ctx?.state?.user?.id;
              if (!userId) throw new Error("Unauthorized");

              const reward = await (strapi as any).entityService.findOne(
                "api::reward.reward",
                args.rewardId
              );
              if (!reward || reward.active === false)
                throw new Error("Reward not available");

              const cards = await (strapi as any).entityService.findMany(
                "api::member-card.member-card",
                { filters: { user: { id: { $eq: userId } } }, limit: 1 }
              );
              const card = Array.isArray(cards) ? cards[0] : cards;
              if (!card) throw new Error("Member card not found");

              const balance = card.pointsBalance ?? 0;
              if (balance < reward.costPoints)
                throw new Error("Insufficient points");

              const redemption = await (strapi as any).entityService.create(
                "api::redemption.redemption",
                {
                  data: {
                    user: userId,
                    reward: args.rewardId,
                    pointsSpent: reward.costPoints,
                    status: "approved",
                    redeemedAt: new Date(),
                  },
                }
              );

              const newBalance = balance - reward.costPoints;
              await (strapi as any).entityService.update(
                "api::member-card.member-card",
                card.id,
                { data: { pointsBalance: newBalance } }
              );

              return {
                ok: true,
                balance: newBalance,
                redemptionId: redemption.id,
                status: redemption.status,
              };
            },
          },
          ensureMyCard: {
            resolve: async (_: unknown, __: unknown, ctx: any) => {
              const userId = ctx?.state?.user?.id;
              if (!userId) throw new Error("Unauthorized");

              // Try to fetch user document to get documentId (for relations using documentId)
              let userDoc: any = null;
              try {
                userDoc = await strapi
                  .documents("plugin::users-permissions.user")
                  .findFirst({ filters: { id: { $eq: userId } } });
              } catch (e) {
                // ignore if documents not enabled
              }

              const userDocumentId = userDoc?.documentId;

              // Try by user id first
              let card = await strapi
                .documents("api::member-card.member-card")
                .findFirst({
                  filters: { user: { documentId: { $eq: userDocumentId } } },
                  limit: 1,
                });

              if (card) return card;

              // Helper to generate a unique card number
              const generateUniqueCardNumber = async (): Promise<string> => {
                const maxAttempts = 10;
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                  const rnd = Math.random()
                    .toString(16)
                    .slice(2, 10)
                    .toUpperCase();
                  const candidate = `LEG-${rnd}`;
                  const existing = await strapi
                    .documents("api::member-card.member-card")
                    .findMany({
                      filters: { cardNumber: { $eq: candidate } },
                      limit: 1,
                    });
                  const exists = Array.isArray(existing)
                    ? existing.length > 0
                    : Boolean(existing);
                  if (!exists) return candidate;
                }
                throw new Error(
                  "Failed to generate unique card number. Please try again."
                );
              };

              const cardNumber = await generateUniqueCardNumber();

              // Use documentId if available, else fallback to numeric id
              const userRelation = userDocumentId ?? userId;

              card = await strapi
                .documents("api::member-card.member-card")
                .create({
                  data: {
                    user: userRelation,
                    cardNumber,
                    pointsBalance: 0,
                    status: "active",
                    tier: "Legends",
                    issuedAt: new Date(),
                  },
                });

              return card;
            },
          },
        },
      },
      UsersPermissionsUser: {
        documentId: async (parent: any) => {
          // If already present (e.g., loaded via documents API), return it
          if (parent?.documentId) return parent.documentId;

          // Fallback: fetch via Documents API by id
          const userDoc = await strapi
            .documents("plugin::users-permissions.user")
            .findFirst({ filters: { id: { $eq: parent.id } } });
          return userDoc?.documentId ?? null;
        },
      },
      MemberCard: {
        documentId: async (parent: any) => {
          if (parent?.documentId) return parent.documentId;
          try {
            const doc = await (strapi as any)
              .documents("api::member-card.member-card")
              .findFirst({ filters: { id: { $eq: parent.id } } });
            return doc?.documentId ?? null;
          } catch (e) {
            return null;
          }
        },
        card_status: (parent: any) => parent?.card_status ?? parent?.status ?? null,
      },
      resolversConfig: {
        "Query.usernameExists": {
          auth: false,
        },
        "Query.myCard": { auth: true },
        "Query.myTransactions": { auth: true },
        "Query.rewards": { auth: true },
        "Query.settings": { auth: true },
        "Mutation.requestEmailOTP": {
          auth: false,
        },
        "Mutation.verifyEmailOTP": {
          auth: false,
        },
        "Mutation.forgotPasswordConfirm": {
          auth: false,
        },
        "Mutation.signup": {
          auth: false,
        },
        "Mutation.login": {
          auth: false,
        },
        "Mutation.scanQRCode": { auth: true },
        "Mutation.redeemReward": { auth: true },
        "Mutation.ensureMyCard": { auth: true },
      },
    }));
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    // Seed App Settings singleton if missing
    try {
      const list = await (strapi as any).entityService.findMany(
        "api::app-setting.app-setting",
        {}
      );
      const item = Array.isArray(list) ? list[0] : list;
      if (!item) {
        await (strapi as any).entityService.create(
          "api::app-setting.app-setting",
          {
            data: {
              defaultPointsPerScan: 1,
              perDay: 1,
              perWeek: 3,
              perMonth: 10,
            },
          }
        );
        strapi.log.info("Seeded App Settings with defaults");
      }
    } catch (e) {
      strapi.log.warn(`App Settings seed failed: ${e?.message ?? e}`);
    }
  },
};
