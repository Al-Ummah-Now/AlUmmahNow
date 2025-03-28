import {
    S3Client,
    ListObjectsV2Command,
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
  } from '@aws-sdk/client-s3';
  
  class R2Repository<T> {
    private S3: S3Client;
    private bucketName: string;
  
    constructor(bucketName: string) {
      this.S3 = new S3Client({
        region: 'auto',
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        endpoint: process.env.S3Api,
        credentials: {
          accessKeyId: process.env.S3Key,
          secretAccessKey: process.env.S3Secret,
        },
      });
      this.bucketName = bucketName;
    }
  
    async listObjects(): Promise<T[]> {
      const listResult = await this.S3.send(new ListObjectsV2Command({ Bucket: this.bucketName }));
  
      if (!listResult.Contents) {
        return [];
      }
  
      const objects = await Promise.all(
        listResult.Contents.map(async (object) => {
          if (!object.Key) return null;
  
          const getObjectResult = await this.S3.send(
            new GetObjectCommand({ Bucket: this.bucketName, Key: object.Key })
          );
  
          const bodyContent = await getObjectResult.Body?.transformToString();
          return bodyContent ? (JSON.parse(bodyContent) as T) : null;
        })
      );
  
      return objects.filter((obj) => obj !== null) as T[];
    }
  
    async getObject(id: string): Promise<T | null> {
      const getObjectResult = await this.S3.send(
        new GetObjectCommand({ Bucket: this.bucketName, Key: id })
      );
  
      const bodyContent = await getObjectResult.Body?.transformToString();
      return bodyContent ? (JSON.parse(bodyContent) as T) : null;
    }
  
    async putObject(id: string, data: T): Promise<void> {
      await this.S3.send(
        new PutObjectCommand({
          Bucket: this.bucketName,
          Key: id,
          Body: JSON.stringify(data),
          ContentType: 'application/json',
        })
      );
    }
  
    async deleteObject(id: string): Promise<void> {
      await this.S3.send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: id }));
    }
  }
  
  export default R2Repository;