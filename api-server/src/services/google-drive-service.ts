import { google, drive_v3 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { Readable } from 'stream';

/**
 * Result of uploading a file to Google Drive
 */
export interface UploadResult {
  fileId: string;
  webViewLink: string;
  name: string;
  size: number;
}

/**
 * Google Drive file info
 */
export interface DriveFileInfo {
  id: string;
  name: string;
  size: number;
  createdTime: string;
  modifiedTime: string;
  webViewLink?: string;
}

/**
 * Service for interacting with Google Drive API.
 * Handles backup file uploads, downloads, and folder management.
 */
export class GoogleDriveService {
  private oauth2Client: OAuth2Client;

  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
  }

  /**
   * Set user credentials for Drive API calls
   */
  setUserCredentials(accessToken: string, refreshToken: string): void {
    this.oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }

  /**
   * Get the OAuth2 client (for token refresh)
   */
  getOAuth2Client(): OAuth2Client {
    return this.oauth2Client;
  }

  /**
   * Create or find the "MinecraftBackups" folder in user's Drive
   */
  async createOrGetBackupFolder(folderName: string = 'MinecraftBackups'): Promise<string> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      // Check if folder already exists
      const existing = await drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        spaces: 'drive',
        fields: 'files(id, name)',
      });

      if (existing.data.files && existing.data.files.length > 0) {
        const folderId = existing.data.files[0].id!;
        console.log(`[GoogleDrive] Found existing folder: ${folderName} (${folderId})`);
        return folderId;
      }

      // Create new folder
      const folder = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          description: 'Minecraft server backups created by Minecraft Hosting Platform',
        },
        fields: 'id',
      });

      const folderId = folder.data.id!;
      console.log(`[GoogleDrive] Created folder: ${folderName} (${folderId})`);
      return folderId;
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to create/get backup folder:', error.message);
      throw new Error(`Failed to access Google Drive: ${error.message}`);
    }
  }

  /**
   * Upload a backup file to user's Google Drive
   */
  async uploadBackup(
    folderId: string,
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string = 'application/gzip'
  ): Promise<UploadResult> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      // Create readable stream from buffer
      const stream = Readable.from(fileBuffer);

      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
          description: `Minecraft server backup - ${new Date().toISOString()}`,
        },
        media: {
          mimeType,
          body: stream,
        },
        fields: 'id, name, size, webViewLink',
      });

      const result: UploadResult = {
        fileId: response.data.id!,
        webViewLink: response.data.webViewLink || '',
        name: response.data.name || fileName,
        size: parseInt(response.data.size || '0', 10),
      };

      console.log(`[GoogleDrive] Uploaded backup: ${fileName} (${result.fileId})`);
      return result;
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to upload backup:', error.message);
      throw new Error(`Failed to upload to Google Drive: ${error.message}`);
    }
  }

  /**
   * Upload a backup file using a readable stream (for large files)
   */
  async uploadBackupStream(
    folderId: string,
    fileName: string,
    fileStream: Readable,
    mimeType: string = 'application/gzip'
  ): Promise<UploadResult> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      const response = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [folderId],
          description: `Minecraft server backup - ${new Date().toISOString()}`,
        },
        media: {
          mimeType,
          body: fileStream,
        },
        fields: 'id, name, size, webViewLink',
      });

      const result: UploadResult = {
        fileId: response.data.id!,
        webViewLink: response.data.webViewLink || '',
        name: response.data.name || fileName,
        size: parseInt(response.data.size || '0', 10),
      };

      console.log(`[GoogleDrive] Uploaded backup stream: ${fileName} (${result.fileId})`);
      return result;
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to upload backup stream:', error.message);
      throw new Error(`Failed to upload to Google Drive: ${error.message}`);
    }
  }

  /**
   * Download a backup file from Google Drive
   */
  async downloadBackup(fileId: string): Promise<Buffer> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      const response = await drive.files.get(
        { fileId, alt: 'media' },
        { responseType: 'arraybuffer' }
      );

      console.log(`[GoogleDrive] Downloaded backup: ${fileId}`);
      return Buffer.from(response.data as ArrayBuffer);
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to download backup:', error.message);
      throw new Error(`Failed to download from Google Drive: ${error.message}`);
    }
  }

  /**
   * Get a readable stream for downloading (for large files)
   */
  async getDownloadStream(fileId: string): Promise<Readable> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      const response = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });

      console.log(`[GoogleDrive] Streaming download: ${fileId}`);
      return response.data as Readable;
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to get download stream:', error.message);
      throw new Error(`Failed to download from Google Drive: ${error.message}`);
    }
  }

  /**
   * Delete a backup file from Google Drive
   */
  async deleteBackup(fileId: string): Promise<void> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      await drive.files.delete({ fileId });
      console.log(`[GoogleDrive] Deleted backup: ${fileId}`);
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to delete backup:', error.message);
      throw new Error(`Failed to delete from Google Drive: ${error.message}`);
    }
  }

  /**
   * List all backups in user's MinecraftBackups folder
   */
  async listBackups(folderId: string): Promise<DriveFileInfo[]> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      const response = await drive.files.list({
        q: `'${folderId}' in parents and trashed=false`,
        spaces: 'drive',
        fields: 'files(id, name, size, createdTime, modifiedTime, webViewLink)',
        orderBy: 'createdTime desc',
        pageSize: 100,
      });

      const files: DriveFileInfo[] = (response.data.files || []).map((file) => ({
        id: file.id!,
        name: file.name!,
        size: parseInt(file.size || '0', 10),
        createdTime: file.createdTime!,
        modifiedTime: file.modifiedTime!,
        webViewLink: file.webViewLink || undefined,
      }));

      console.log(`[GoogleDrive] Listed ${files.length} backups in folder ${folderId}`);
      return files;
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to list backups:', error.message);
      throw new Error(`Failed to list files from Google Drive: ${error.message}`);
    }
  }

  /**
   * Get info about a specific file
   */
  async getFileInfo(fileId: string): Promise<DriveFileInfo> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      const response = await drive.files.get({
        fileId,
        fields: 'id, name, size, createdTime, modifiedTime, webViewLink',
      });

      return {
        id: response.data.id!,
        name: response.data.name!,
        size: parseInt(response.data.size || '0', 10),
        createdTime: response.data.createdTime!,
        modifiedTime: response.data.modifiedTime!,
        webViewLink: response.data.webViewLink || undefined,
      };
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to get file info:', error.message);
      throw new Error(`Failed to get file info from Google Drive: ${error.message}`);
    }
  }

  /**
   * Get storage quota information
   */
  async getStorageQuota(): Promise<{ used: number; limit: number }> {
    const drive = google.drive({ version: 'v3', auth: this.oauth2Client });

    try {
      const response = await drive.about.get({
        fields: 'storageQuota',
      });

      const quota = response.data.storageQuota;
      return {
        used: parseInt(quota?.usage || '0', 10),
        limit: parseInt(quota?.limit || '0', 10),
      };
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to get storage quota:', error.message);
      throw new Error(`Failed to get storage quota: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(): Promise<{ accessToken: string; expiresAt: Date }> {
    try {
      const { credentials } = await this.oauth2Client.refreshAccessToken();

      return {
        accessToken: credentials.access_token!,
        expiresAt: new Date(credentials.expiry_date!),
      };
    } catch (error: any) {
      console.error('[GoogleDrive] Failed to refresh token:', error.message);
      throw new Error(`Failed to refresh Google token: ${error.message}`);
    }
  }
}

// Factory function to create service with user credentials
export function createDriveServiceForUser(
  accessToken: string,
  refreshToken: string
): GoogleDriveService {
  const service = new GoogleDriveService();
  service.setUserCredentials(accessToken, refreshToken);
  return service;
}
