import { PaginationResponse, ResponseError, VideoInfo, VideoObject } from "@/interfaces";
import { NextRequest, NextResponse } from "next/server";
import R2Repository from "../r2Repo";

export async function GET(request: NextRequest) : Promise<NextResponse<PaginationResponse<VideoObject> | ResponseError>> {
    const searchParams = request.nextUrl.searchParams
    const cursor = searchParams.get('cursor') ?? '';
    const limit = parseInt(searchParams.get('limit') ?? '10');
    const bucketName = 'videos'; // Replace with your bucket name
    const repository = new R2Repository<VideoObject>(bucketName);
    try {
        // List all videos with pagination
        console.log(`cursor: ${cursor}, limit: ${limit}`);
        const result = await repository.listObjects(limit, cursor);

        const response: PaginationResponse<VideoObject> = {
            cursor: result.cursor,
            limit,
            total: result.items.length,
            data: result.items,
        };
        return NextResponse.json(response);
    } catch (error) {
        console.error(error);
        console.log((error as Error).stack);
        return NextResponse.json(
            { message: `Error fetching objects from R2.`, error: error},
            { status: 500 },
        );
    }
}