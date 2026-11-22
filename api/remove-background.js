
const Busboy = require("busboy");

module.exports.config = {
  api: {
    bodyParser: false
  }
};

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Use POST to upload an image."
    });
  }

  const apiKey = process.env.PIXELCUT_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Pixelcut API key is not configured."
    });
  }

  try {
    const image = await new Promise((resolve, reject) => {
      const bb = Busboy({
        headers: req.headers,
        limits: {
          fileSize: 4 * 1024 * 1024,
          files: 1
        }
      });

      let uploaded = null;
      let tooLarge = false;

      bb.on("file", (field, stream, info) => {
        if (field !== "image") {
          stream.resume();
          return;
        }

        const chunks = [];

        stream.on("data", chunk => chunks.push(chunk));

        stream.on("limit", () => {
          tooLarge = true;
        });

        stream.on("end", () => {
          uploaded = {
            buffer: Buffer.concat(chunks),
            mime: info.mimeType,
            filename: info.filename
          };
        });
      });

      bb.on("error", reject);

      bb.on("finish", () => {
        if (tooLarge) {
          return reject(new Error("IMAGE_TOO_LARGE"));
        }

        if (!uploaded) {
          return reject(new Error("IMAGE_MISSING"));
        }

        resolve(uploaded);
      });

      req.pipe(bb);
    });

    const form = new FormData();

    form.append(
      "image",
      new Blob([image.buffer], {
        type: image.mime
      }),
      image.filename || "image.png"
    );

    form.append("format", "png");

    const pixelcut = await fetch(
      "https://api.developer.pixelcut.ai/v1/remove-background",
      {
        method: "POST",
        headers: {
          "X-API-KEY": apiKey,
          "Accept": "image/*"
        },
        body: form
      }
    );

    if (!pixelcut.ok) {
      let errorCode = "upstream_error";

      try {
        const data = await pixelcut.json();
        errorCode = data.error_code || errorCode;
      } catch (_) {}

      return res.status(502).json({
        error: "Pixelcut processing failed.",
        code: pixelcut.status,
        reason: errorCode
      });
    }

    const contentType =
      pixelcut.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const data = await pixelcut.json();

      if (!data.result_url) {
        return res.status(502).json({
          error: "Pixelcut returned no result image."
        });
      }

      const result = await fetch(data.result_url);

      if (!result.ok) {
        return res.status(502).json({
          error: "Could not retrieve the processed image."
        });
      }

      const buffer = Buffer.from(
        await result.arrayBuffer()
      );

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-store");

      return res.status(200).send(buffer);
    }

    const output = Buffer.from(
      await pixelcut.arrayBuffer()
    );

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");

    return res.status(200).send(output);

  } catch (error) {
    if (error.message === "IMAGE_TOO_LARGE") {
      return res.status(413).json({
        error: "Image is too large. Use an image under 4 MB."
      });
    }

    if (error.message === "IMAGE_MISSING") {
      return res.status(400).json({
        error: "Please upload an image using the image field."
      });
    }

    return res.status(500).json({
      error: "The background-removal request failed."
    });
  }
};
