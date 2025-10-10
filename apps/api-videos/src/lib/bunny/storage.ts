import * as BunnyStorageSDK from "@bunny.net/storage-sdk";

class BunnyStorageClient {
    readonly sz: BunnyStorageSDK.StorageZone;

    constructor(sz_zone: string, access_key: string) {
        this.sz = BunnyStorageSDK.zone.connect_with_accesskey(BunnyStorageSDK.regions.StorageRegion.Falkenstein, sz_zone, access_key);
    }

    async listFiles(path): Promise<string[]> {
        let list = await BunnyStorageSDK.file.list(this.sz, path);
        return list.map((item) => {
            return item.objectName;
        });
    }

    async getFile(path: string): Promise<string | null> {
        let file = await BunnyStorageSDK.file.get(this.sz, `${path}`);
        return file.objectName;
    }

    async putFile(path: string, data: ReadableStream): Promise<boolean> {
        try {
            return await BunnyStorageSDK.file.upload(this.sz, `${path}`, data);
        }
        catch (error) {
            console.error("Error uploading file:", error);
            return false;
        }
    }

    async deleteFile(path: string): Promise<void> {
        await BunnyStorageSDK.file.remove(this.sz, `${path}`);
    }
}

export default BunnyStorageClient;