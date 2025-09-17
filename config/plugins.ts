export default () => ({
  graphql: {
    config: {
      endpoint: "/graphql", // <— single GraphQL endpoint
      subscriptions: false,
    },
  },
  email: {
    config: {
      provider: "@strapi/provider-email-nodemailer",
      providerOptions: {
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure:
          String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      },
      settings: {
        defaultFrom: process.env.EMAIL_DEFAULT_FROM,
        defaultReplyTo: process.env.EMAIL_DEFAULT_REPLY_TO,
      },
    },
  },
  upload: {
    config: {
      provider: "aws-s3",
      providerOptions: {
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
        region: process.env.AWS_REGION,
        params: {
          ACL: null,
          Bucket: process.env.AWS_BUCKET,
        },
        httpOptions: {
          timeout: 300000, // 5 min, avoids timeout on big files
        },
      },
      actionOptions: {
        upload: {},
        uploadStream: {},
        delete: {},
      },
    },
  },
});
