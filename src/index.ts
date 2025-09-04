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
        }

        extend type Mutation {
          requestEmailOTP(email: String!): OTPRequestPayload
          verifyEmailOTP(email: String!, code: String!): VerifyOTPPayload
        }
      `,
      resolvers: {
        Mutation: {
          requestEmailOTP: {
            resolve: async (_: unknown, args: { email: string }) => {
              const email = args.email?.trim().toLowerCase();
              if (!email) throw new Error("Email is required");

              const user = await strapi.db
                .query("plugin::users-permissions.user")
                .findOne({ where: { email } });

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

              const user = await strapi.db
                .query("plugin::users-permissions.user")
                .findOne({ where: { email } });

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

              // Issue JWT
              const jwtService: any = strapi.service(
                "plugin::users-permissions.jwt"
              );
              const jwt = await jwtService.issue({ id: user.id });

              return { ok: true, jwt, userId: user.id };
            },
          },
        },
      },
      resolversConfig: {
        "Mutation.requestEmailOTP": {
          auth: false,
        },
        "Mutation.verifyEmailOTP": {
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
