import { logger } from '../utils/logger';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import crypto from 'crypto';
import * as ftp from 'basic-ftp';
import SftpClient = require('ssh2-sftp-client');

// Accepts either name: existing deployments (Render, .env.example) already
// document UPLOAD_ROOT; the code historically read UPLOAD_DIR instead, so
// UPLOAD_ROOT was silently never applied. Both now work.
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || process.env.UPLOAD_ROOT || path.join(process.cwd(), 'uploads');

const MAX_SIZE = 10 * 1024 * 1024; // 10MB

export const propertyImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

export const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

/**
 * Reusable helper to process image buffer before storage
 */
export async function processImageBuffer(
  buffer: Buffer,
): Promise<{ processedBuffer: Buffer; filename: string }> {
  const processedBuffer = await sharp(buffer)
    .resize(2560, 2560, {
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();

  const uuid = crypto.randomUUID();
  const filename = `${uuid}.webp`;

  return { processedBuffer, filename };
}

export interface PropertyImageStorage {
  upload(buffer: Buffer, propertyId: number): Promise<string>;
  delete(imageUrl: string): Promise<void>;
}

export class LocalPropertyImageStorage implements PropertyImageStorage {
  async upload(buffer: Buffer, propertyId: number): Promise<string> {
    const { processedBuffer, filename } = await processImageBuffer(buffer);
    const propertyImagesDir = path.join(UPLOAD_DIR, 'properties', String(propertyId), 'images');

    if (!fs.existsSync(propertyImagesDir)) {
      fs.mkdirSync(propertyImagesDir, { recursive: true });
    }

    const absolutePath = path.join(propertyImagesDir, filename);
    await fs.promises.writeFile(absolutePath, processedBuffer);

    return `/uploads/properties/${propertyId}/images/${filename}`;
  }

  async delete(imageUrl: string): Promise<void> {
    const match = imageUrl.match(
      /^\/uploads\/(properties\/\d+\/images\/[a-f0-9-]+\.webp|property-images\/prop-[0-9-]+\.[a-z]+)$/i,
    );
    if (!match) {
      logger.warn(`Invalid or unrecognizable image URL for deletion: ${imageUrl}`);
      return;
    }

    const relativeSafePath = match[1];
    const absolutePath = path.join(UPLOAD_DIR, relativeSafePath);

    if (absolutePath.startsWith(path.resolve(UPLOAD_DIR)) && fs.existsSync(absolutePath)) {
      try {
        fs.unlinkSync(absolutePath);
      } catch (err) {
        logger.error(`Failed to delete physical file: ${absolutePath}`, err);
      }
    }
  }
}

async function getFtpClient() {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  await client.access({
    host: process.env.FTP_HOST,
    user: process.env.FTP_USERNAME,
    password: process.env.FTP_PASSWORD,
    port: parseInt(process.env.FTP_PORT || '21', 10),
    secure: false,
  });
  return client;
}

export class FtpPropertyImageStorage implements PropertyImageStorage {
  async upload(buffer: Buffer, propertyId: number): Promise<string> {
    const client = await getFtpClient();
    try {
      const { processedBuffer, filename } = await processImageBuffer(buffer);
      const remoteDir = path.posix.join(
        process.env.FTP_REMOTE_BASE_PATH || '',
        'properties',
        String(propertyId),
        'images',
      );

      // ensureDir has the side effect of navigating the FTP session's CWD
      // into remoteDir (confirmed against the real Hostinger account: PWD
      // after ensureDir('uploads/properties/x/images') is that full path,
      // not the login root) — uploading with the full remoteDir+filename
      // path again on top of that looked for a doubled-up path and always
      // 550'd. Upload by filename alone, relative to the now-current dir.
      await client.ensureDir(remoteDir);

      // Write buffer to stream for basic-ftp
      const { Readable } = await import('stream');
      const stream = Readable.from(processedBuffer);

      await client.uploadFrom(stream, filename);

      const baseUrl = process.env.FTP_PUBLIC_BASE_URL || '';
      return `${baseUrl}/properties/${propertyId}/images/${filename}`;
    } finally {
      client.close();
    }
  }

  async delete(imageUrl: string): Promise<void> {
    const baseUrl = process.env.FTP_PUBLIC_BASE_URL || '';
    if (!imageUrl.startsWith(baseUrl)) {
      logger.warn(`Cannot delete FTP image, URL does not match base URL: ${imageUrl}`);
      return;
    }

    const relativePath = imageUrl.slice(baseUrl.length);
    const remotePath = path.posix.join(process.env.FTP_REMOTE_BASE_PATH || '', relativePath);

    const client = await getFtpClient();
    try {
      await client.remove(remotePath);
    } catch (err) {
      logger.error(`Failed to delete remote FTP file: ${remotePath}`, err);
    } finally {
      client.close();
    }
  }
}

// ---------------------------------------------------------------------------
// SFTP (SSH File Transfer Protocol) — most managed hosts (Hostinger, cPanel,
// Render's persistent-disk alternative) expose SFTP, not the plaintext FTP
// basic-ftp implements above. `ssh2-sftp-client` was already an installed
// dependency (package.json) but had never actually been wired up — every
// property/image/document upload silently ran in local-disk mode instead.
// ---------------------------------------------------------------------------

async function getSftpClient() {
  const client = new SftpClient();
  const config: any = {
    host: process.env.SFTP_HOST,
    port: parseInt(process.env.SFTP_PORT || '22', 10),
    username: process.env.SFTP_USERNAME,
  };
  // Either a password or a private key works — whichever the host provides.
  if (process.env.SFTP_PRIVATE_KEY) {
    config.privateKey = process.env.SFTP_PRIVATE_KEY;
    if (process.env.SFTP_PASSPHRASE) config.passphrase = process.env.SFTP_PASSPHRASE;
  } else {
    config.password = process.env.SFTP_PASSWORD;
  }
  await client.connect(config);
  return client;
}

export class SftpPropertyImageStorage implements PropertyImageStorage {
  async upload(buffer: Buffer, propertyId: number): Promise<string> {
    const client = await getSftpClient();
    try {
      const { processedBuffer, filename } = await processImageBuffer(buffer);
      const remoteDir = path.posix.join(
        process.env.SFTP_REMOTE_BASE_PATH || '',
        'properties',
        String(propertyId),
        'images',
      );
      await client.mkdir(remoteDir, true);
      const remotePath = path.posix.join(remoteDir, filename);
      await client.put(processedBuffer, remotePath);
      const baseUrl = process.env.SFTP_PUBLIC_BASE_URL || '';
      return `${baseUrl}/properties/${propertyId}/images/${filename}`;
    } finally {
      await client.end();
    }
  }

  async delete(imageUrl: string): Promise<void> {
    const baseUrl = process.env.SFTP_PUBLIC_BASE_URL || '';
    if (!imageUrl.startsWith(baseUrl)) {
      logger.warn(`Cannot delete SFTP image, URL does not match base URL: ${imageUrl}`);
      return;
    }
    const relativePath = imageUrl.slice(baseUrl.length);
    const remotePath = path.posix.join(process.env.SFTP_REMOTE_BASE_PATH || '', relativePath);
    const client = await getSftpClient();
    try {
      await client.delete(remotePath);
    } catch (err) {
      logger.error(`Failed to delete remote SFTP file: ${remotePath}`, err);
    } finally {
      await client.end();
    }
  }
}

export class SftpStorageService implements StorageService {
  constructor(private readonly remoteSubdir: string = 'documents') {}

  async upload(buffer: Buffer, originalName: string, _mimeType: string): Promise<string> {
    const ext = path.extname(originalName).toLowerCase() || '.bin';
    const filename = `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const client = await getSftpClient();
    try {
      const remoteDir = path.posix.join(process.env.SFTP_REMOTE_BASE_PATH || '', this.remoteSubdir);
      await client.mkdir(remoteDir, true);
      const remotePath = path.posix.join(remoteDir, filename);
      await client.put(buffer, remotePath);
      const baseUrl = process.env.SFTP_PUBLIC_BASE_URL || '';
      return `${baseUrl}/${this.remoteSubdir}/${filename}`;
    } finally {
      await client.end();
    }
  }

  async download(storagePath: string): Promise<Buffer> {
    const baseUrl = process.env.SFTP_PUBLIC_BASE_URL || '';
    if (!storagePath.startsWith(baseUrl)) {
      throw new Error(`Cannot download SFTP file, URL does not match base URL: ${storagePath}`);
    }
    const relativePath = storagePath.slice(baseUrl.length);
    const remotePath = path.posix.join(process.env.SFTP_REMOTE_BASE_PATH || '', relativePath);
    const client = await getSftpClient();
    try {
      const data = await client.get(remotePath);
      return Buffer.isBuffer(data) ? data : Buffer.from(data as any);
    } finally {
      await client.end();
    }
  }

  async delete(storagePath: string): Promise<void> {
    const baseUrl = process.env.SFTP_PUBLIC_BASE_URL || '';
    if (!storagePath.startsWith(baseUrl)) {
      logger.warn(`Cannot delete SFTP file, URL does not match base URL: ${storagePath}`);
      return;
    }
    const relativePath = storagePath.slice(baseUrl.length);
    const remotePath = path.posix.join(process.env.SFTP_REMOTE_BASE_PATH || '', relativePath);
    const client = await getSftpClient();
    try {
      await client.delete(remotePath);
    } catch (err) {
      logger.error(`Failed to delete remote SFTP file: ${remotePath}`, err);
    } finally {
      await client.end();
    }
  }
}

export function getPropertyImageStorage(): PropertyImageStorage {
  if (process.env.STORAGE_DRIVER === 'sftp') {
    return new SftpPropertyImageStorage();
  }
  if (process.env.STORAGE_DRIVER === 'ftp') {
    return new FtpPropertyImageStorage();
  }
  return new LocalPropertyImageStorage();
}

/**
 * Storage abstraction used by the document module.
 * Implementations must return relative, public-safe storage paths and must
 * never expose full server filesystem paths.
 */
export interface StorageService {
  upload(buffer: Buffer, originalName: string, mimeType: string): Promise<string>;
  download(storagePath: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
}

export class LocalStorageService implements StorageService {
  private readonly baseDir: string;
  private readonly subdir: string;

  // `subdir` used to be silently dropped — every caller (project layout
  // images, project media/documents, employee profile photos) wrote into a
  // single hardcoded uploads/documents/ folder regardless of what subdir it
  // asked for, while the URL it returned pointed at uploads/<subdir>/... —
  // a path server.ts never even serves statically for anything but
  // properties/profiles. Every non-property local upload was effectively
  // unreachable. Now the class actually uses the subdir it's given.
  constructor(baseDir: string, subdir: string = 'documents') {
    this.baseDir = path.resolve(baseDir);
    this.subdir = subdir;
  }

  private resolveSafe(storagePath: string): string {
    const resolved = path.resolve(this.baseDir, storagePath);
    if (!resolved.startsWith(this.baseDir + path.sep)) {
      throw new Error('Invalid storage path');
    }
    return resolved;
  }

  async upload(buffer: Buffer, originalName: string, _mimeType: string): Promise<string> {
    const ext = path.extname(originalName).toLowerCase() || '.bin';
    const filename = `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const relativePath = path.posix.join(this.subdir, filename);
    const dir = path.join(this.baseDir, this.subdir);
    fs.mkdirSync(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, filename), buffer);
    return `/uploads/${relativePath}`; // Make it accessible via public URL locally
  }

  async download(storagePath: string): Promise<Buffer> {
    const relativePath = storagePath.replace(/^\/uploads\//, '');
    return fs.promises.readFile(this.resolveSafe(relativePath));
  }

  async delete(storagePath: string): Promise<void> {
    const relativePath = storagePath.replace(/^\/uploads\//, '');
    const filepath = this.resolveSafe(relativePath);
    if (fs.existsSync(filepath)) {
      await fs.promises.unlink(filepath);
    }
  }
}

export class FtpStorageService implements StorageService {
  private readonly remoteSubdir: string;

  constructor(remoteSubdir: string = 'documents') {
    this.remoteSubdir = remoteSubdir;
  }

  async upload(buffer: Buffer, originalName: string, _mimeType: string): Promise<string> {
    const ext = path.extname(originalName).toLowerCase() || '.bin';
    const filename = `doc-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

    const client = await getFtpClient();
    try {
      const remoteDir = path.posix.join(process.env.FTP_REMOTE_BASE_PATH || '', this.remoteSubdir);
      // ensureDir navigates the session's CWD into remoteDir — see the
      // matching fix/comment in FtpPropertyImageStorage.upload above.
      await client.ensureDir(remoteDir);

      const { Readable } = await import('stream');
      const stream = Readable.from(buffer);

      await client.uploadFrom(stream, filename);

      const baseUrl = process.env.FTP_PUBLIC_BASE_URL || '';
      return `${baseUrl}/${this.remoteSubdir}/${filename}`;
    } finally {
      client.close();
    }
  }

  async download(storagePath: string): Promise<Buffer> {
    const baseUrl = process.env.FTP_PUBLIC_BASE_URL || '';
    if (!storagePath.startsWith(baseUrl)) {
      throw new Error(`Cannot download FTP file, URL does not match base URL: ${storagePath}`);
    }

    const relativePath = storagePath.slice(baseUrl.length);
    const remotePath = path.posix.join(process.env.FTP_REMOTE_BASE_PATH || '', relativePath);

    const client = await getFtpClient();
    try {
      const { PassThrough } = await import('stream');
      const stream = new PassThrough();
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));

      await client.downloadTo(stream, remotePath);
      return Buffer.concat(chunks);
    } finally {
      client.close();
    }
  }

  async delete(storagePath: string): Promise<void> {
    const baseUrl = process.env.FTP_PUBLIC_BASE_URL || '';
    if (!storagePath.startsWith(baseUrl)) {
      logger.warn(`Cannot delete FTP file, URL does not match base URL: ${storagePath}`);
      return;
    }

    const relativePath = storagePath.slice(baseUrl.length);
    const remotePath = path.posix.join(process.env.FTP_REMOTE_BASE_PATH || '', relativePath);

    const client = await getFtpClient();
    try {
      await client.remove(remotePath);
    } catch (err) {
      logger.error(`Failed to delete remote FTP file: ${remotePath}`, err);
    } finally {
      client.close();
    }
  }
}

export function getStorageService(subdir: string = 'documents'): StorageService {
  if (process.env.STORAGE_DRIVER === 'sftp') {
    return new SftpStorageService(subdir);
  }
  if (process.env.STORAGE_DRIVER === 'ftp') {
    return new FtpStorageService(subdir);
  }
  return new LocalStorageService(UPLOAD_DIR, subdir);
}
