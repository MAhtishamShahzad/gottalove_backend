import QRCode from "qrcode";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { writeFile, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const ensureToken = (data: any) => {
  if (
    !data.qrToken ||
    typeof data.qrToken !== "string" ||
    !data.qrToken.trim()
  ) {
    data.qrToken = crypto.randomBytes(24).toString("hex");
  }
};

const generateSixDigit = () =>
  String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");

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
  console.log("uploading", buffer);

  // Write buffer to a temporary file so Strapi upload service can create a read stream from path
  const tmpFileName = `${Date.now()}-${fileName}`;
  const tmpPath = path.join(os.tmpdir(), tmpFileName);
  await writeFile(tmpPath, buffer);

  console.log("tmpPath", tmpPath, fileName);

  const file = {
    // Provide both keys for compatibility with different parsers
    path: tmpPath,
    filepath: tmpPath,
    tmpPath: tmpPath,
    name: fileName,
    filename: fileName,
    originalFilename: fileName,
    type: "image/png",
    mime: "image/png",
    mimetype: "image/png",
    ext: ".png",
    size: buffer.length,
  } as any;

  try {
    const uploaded = await uploadService.upload({
      data: {
        fileInfo: {
          name: fileName,
          alternativeText: "QR code",
          caption: "Auto-generated QR image",
        },
      },
      files: [file],
    });
    console.log("uploaded", uploaded);
    const first = Array.isArray(uploaded) ? uploaded[0] : uploaded;
    return first;
  } finally {
    // Cleanup temp file regardless of success/failure
    try {
      await unlink(tmpPath);
    } catch (err) {
      // ignore cleanup errors
    }
  }
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
        if (
          typeof tokenCurrent === "string" &&
          tokenCurrent.trim().length > 0
        ) {
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
