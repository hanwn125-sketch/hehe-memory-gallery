import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const password = process.argv[2];
if (!password) {
  console.error("Usage: node scripts/encrypt-assets.mjs <password>");
  process.exit(1);
}

const root = process.cwd();
const secureDir = join(root, "secure");
const iterations = 250000;
const salt = randomBytes(16);
const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");

const encrypt = (buffer) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final(), cipher.getAuthTag()]);
  return Buffer.concat([iv, ciphertext]);
};

const writeEncrypted = async (relativePath, buffer) => {
  const output = join(root, relativePath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, encrypt(buffer));
};

await rm(secureDir, { recursive: true, force: true });
await mkdir(secureDir, { recursive: true });

const gallery = JSON.parse(await readFile(join(root, "data", "gallery.json"), "utf8"));
let assetIndex = 0;

for (const album of gallery.albums) {
  for (const item of album.items) {
    if (item.type !== "image" && item.type !== "video") continue;
    const sourcePath = join(root, item.src);
    const originalExt = item.type === "video" ? ".mp4" : ".jpg";
    const encryptedSrc = `secure/assets/${String(++assetIndex).padStart(4, "0")}${originalExt}.bin`;
    await writeEncrypted(encryptedSrc, await readFile(sourcePath));
    item.src = encryptedSrc;
  }
}

await writeEncrypted("secure/gallery.bin", Buffer.from(JSON.stringify(gallery), "utf8"));
await writeFile(
  join(root, "secure", "config.json"),
  JSON.stringify(
    {
      version: 1,
      kdf: "PBKDF2-SHA256",
      cipher: "AES-256-GCM",
      iterations,
      salt: salt.toString("base64"),
      manifest: "secure/gallery.bin",
    },
    null,
    2,
  ),
);

await rm(join(root, "data"), { recursive: true, force: true });
await rm(join(root, "public"), { recursive: true, force: true });

console.log(`Encrypted ${assetIndex} assets.`);
console.log("Removed plaintext data/ and public/ from deploy folder.");
