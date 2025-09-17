import QRCode from "qrcode";
import crypto from "node:crypto";

const ensureToken = (data: any) => {
  if (
    !data.qrToken ||
    typeof data.qrToken !== "string" ||
    !data.qrToken.trim()
  ) {
    data.qrToken = crypto.randomBytes(24).toString("hex");
  }
};

const generateSixDigit = () => String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");

const ensureEntryCode = async (data: any, currentId?: string | number) => {
  const isValid = (v: any) => typeof v === "string" && /^\d{6}$/.test(v);

  // If provided and valid, still ensure uniqueness; otherwise generate a new one
  let code = isValid(data.entryCode) ? data.entryCode : undefined;

  for (let i = 0; i < 10; i++) {
    if (!code) code = generateSixDigit();

    // Check uniqueness among existing locations
    const filters: any = { entryCode: { $eq: code } };
    if (currentId) {
      filters.id = { $ne: currentId };
    }
    const existing = await (strapi as any).entityService.findMany(
      "api::location.location",
      {
        filters,
        limit: 1,
      }
    );
    const taken = Array.isArray(existing) ? existing[0] : existing;
    if (!taken) {
      data.entryCode = code;
      return;
    }

    // Collision: try another
    code = undefined;
  }

  // Fallback after attempts
  data.entryCode = generateSixDigit();
};

const makeQRBuffer = async (token: string) => {
  const payload = token;
  return QRCode.toBuffer(payload, {
    width: 1024,
    margin: 1,
    errorCorrectionLevel: "M",
  });
};

const uploadBufferAsImage = async (buffer: Buffer, fileName: string) => {
  const uploadService = (strapi as any).plugin("upload").service("upload");
  const file = {
    name: fileName,
    type: "image/png",
    size: buffer.length,
    buffer,
  } as any;

  const uploaded = await uploadService.upload({ data: {}, files: file });
  const first = Array.isArray(uploaded) ? uploaded[0] : uploaded;
  return first;
};

export default {
  async beforeCreate(event: any) {
    try {
      const data = event.params?.data || {};
      ensureToken(data);
      await ensureEntryCode(data);

      if (!data.qrImage) {
        const buffer = await makeQRBuffer(data.qrToken);
        const uploaded = await uploadBufferAsImage(buffer, `location-qr.png`);
        console.log("uploaded", uploaded);

        if (uploaded?.id) {
          data.qrImage = uploaded.id;
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  async beforeUpdate(event: any) {
    try {
      const data = event.params?.data || {};

      const whereId = event.params?.where?.id;
      let current: any = null;
      if (whereId) {
        current = await (strapi as any).entityService.findOne(
          "api::location.location",
          whereId,
          {
            populate: { qrImage: true },
          }
        );
      }

      const tokenCurrent = current?.qrToken as string | undefined;

      // Preserve existing token on update if not explicitly provided
      const providedToken = data.qrToken;
      const providedTokenValid =
        typeof providedToken === "string" && providedToken.trim().length > 0;
      if (!providedTokenValid) {
        if (typeof tokenCurrent === "string" && tokenCurrent.trim().length > 0) {
          data.qrToken = tokenCurrent;
        } else {
          // No current token exists either, generate a fresh one
          ensureToken(data);
        }
      }

      // Preserve existing entryCode if not provided; still ensure uniqueness
      if (!data.entryCode && current?.entryCode) {
        data.entryCode = current.entryCode;
      }
      await ensureEntryCode(data, whereId);

      const finalToken = data.qrToken as string | undefined;
      const tokenChanged =
        typeof finalToken === "string" && finalToken !== tokenCurrent;
      const imageMissingAfterUpdate = !data.qrImage && !current?.qrImage;

      if (tokenChanged || imageMissingAfterUpdate) {
        const buffer = await makeQRBuffer(data.qrToken);
        const uploaded = await uploadBufferAsImage(buffer, `location-qr.png`);
        if (uploaded?.id) {
          data.qrImage = uploaded.id;
        }
      }
    } catch (e) {
      console.error(e);
    }
  },
};
