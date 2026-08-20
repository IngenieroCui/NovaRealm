import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type CloudinaryUploadSignature = {
  apiKey: string;
  cloudName: string;
  folder: string;
  signature: string;
  timestamp: number;
};

/** Generates short-lived signatures without ever exposing the Cloudinary secret. */
@Injectable()
export class CloudinaryService {
  createUploadSignature(): CloudinaryUploadSignature {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
    const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
    const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();

    if (!cloudName || !apiKey || !apiSecret) {
      throw new ServiceUnavailableException(
        'Cloudinary no está configurado. Define CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET en el backend.',
      );
    }

    const folder = (
      process.env.CLOUDINARY_UPLOAD_FOLDER?.trim() || 'novarealm/products'
    ).replace(/^\/+|\/+$/g, '');
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHash('sha1')
      .update(`folder=${folder}&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');

    return { apiKey, cloudName, folder, signature, timestamp };
  }
}
