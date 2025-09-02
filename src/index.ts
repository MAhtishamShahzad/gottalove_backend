import type { Core } from '@strapi/strapi';

export default {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/* { strapi }: { strapi: Core.Strapi } */) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }: { strapi: Core.Strapi }) {
    const AWS = require("aws-sdk");
    const s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION,
      httpOptions: { timeout: 300000 },
      maxRetries: 2,
    });

    try {
      await s3.headBucket({ Bucket: process.env.AWS_BUCKET }).promise();
      strapi.log.info("✅ S3 connection successful (bucket: %s, region: %s)", process.env.AWS_BUCKET, process.env.AWS_REGION);
    } catch (err) {
      const msg = err && (err.message || err.code || String(err));
      strapi.log.error("❌ S3 connection failed: %s", msg);
    }
  },
};
