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
        }

        type SignupPayload {
          ok: Boolean!
          jwt: String
          user: SignupUser
        }

        # Extend built-in UsersPermissionsUser to expose documentId
        extend type UsersPermissionsUser {
          documentId: ID
        }

        extend type Query {
          usernameExists(username: String!): Boolean!
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
          ): SignupPayload
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
              }
            ) => {
              const email = args.email?.trim().toLowerCase();
              const username = args.username?.trim();
              const name = args.name?.trim();
              const password = args.password;
              if (!email || !username || !password) {
                throw new Error("email, username and password are required");
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
                    ...(authRole?.id ? { role: authRole.id } : {}),
                  },
                }
              );

              // Issue JWT
              const jwtService: any = strapi.service(
                "plugin::users-permissions.jwt"
              );
              const jwt = await jwtService.issue({ id: created.id });

              return {
                ok: true,
                jwt,
                user: {
                  id: created.id,
                  documentId: created.documentId,
                  email: created.email,
                  username: created.username,
                  name: created.name,
                  confirmed: created.confirmed,
                  blocked: created.blocked,
                },
              };
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
      resolversConfig: {
        "Query.usernameExists": {
          auth: false,
        },
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
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {},
};
