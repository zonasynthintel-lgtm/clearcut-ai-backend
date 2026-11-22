
const Busboy = require("busboy");

module.exports = async function handler(req, res) {
  // Temporary CORS setting for testing.
  // Later, restrict this to your own website's origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST requests are allowed."
    });
  }

  const apiKey = process.env.PIXELCUT_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "Pixelcut API key is not configured on Vercel."
    });
  }

  try {
    const bb = Busboy({
      headers: req.headers,
      limits: {
        files: 1,
        fileSize: 4 * 1024 * 1024
      }
    });

    let imageBuffer = null;
    let imageName = "upload.png";
    let imageType = "image/png";
    let uploadError = null;

    bb.on("file", (field, stream, info) => {
      if (field !== "image") {
        stream.resume();
        return;
      }

      imageName = info.filename || imageName;
      imageType = info.mimeType || imageType;

      const chunks = [];

      stream.on("data", chunk => {
        chunks.push(chunk);
      });

      stream.on("limit", () => {
        uploadError = "Image exceeds the 4 MB upload limit.";
      });

      stream.on("end", () => {
        imageBuffer = Buffer.concat(chunks);
      });
    });

    bb.on("error", error => {
      uploadError = error.message;
    });

    bb.on("finish", async () => {
      try {
        if (uploadError) {
          return res.status(400).json({
            error: uploadError
          });
        }

        if (!imageBuffer || imageBuffer.length === 0) {
          return res.status(400).json({
            error: "No image was uploaded."
          });
        }

        const form = new FormData();

        form.append(
          "image",
          new Blob([imageBuffer], { type: imageType }),
          imageName
        );

        form.append("format", "png");

        const pixelcutResponse = await fetch(
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

        if (!pixelcutResponse.ok) {
          const details = await pixelcutResponse.text();

          return res.status(pixelcutResponse.status).json({
            error: "Pixelcut API request failed.",
            details: details.slice(0, 500)
          });
        }

        const output = Buffer.from(
          await pixelcutResponse.arrayBuffer()
        );

        res.setHeader(
          "Content-Type",
          pixelcutResponse.headers.get("content-type") ||
            "image/png"
        );

        res.setHeader(
          "Content-Disposition",
          'inline; filename="clearcut-result.png"'
        );

        res.setHeader("Cache-Control", "no-store");

        return res.status(200).send(output);

      } catch (error) {
        return res.status(500).json({
          error: error.message || "Background removal failed."
        });
      }
    });

    req.pipe(bb);

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Backend error."
    });
  }
};

