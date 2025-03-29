import { PaginationResponse, ResponseError, VideoInfo, VideoObject } from "@/app/interfaces";
import { NextRequest, NextResponse } from "next/server";
import R2Repository from "../r2Repo";

export async function GET(request: NextRequest) : Promise<NextResponse<PaginationResponse<VideoObject> | ResponseError>> {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') ?? '1');
    const limit = parseInt(searchParams.get('limit') ?? '10');
    const bucketName = 'videos'; // Replace with your bucket name
    const repository = new R2Repository<VideoObject>(bucketName);
    try {
        // List all videos with pagination
        console.log(`page: ${page}, limit: ${limit}`);
        const allVideos = await repository.listObjects();

        // Calculate pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedVideos = allVideos.slice(startIndex, endIndex);

        const response: PaginationResponse<VideoObject> = {
            page,
            limit,
            total: allVideos.length,
            totalPages: Math.ceil(allVideos.length / limit),
            data: paginatedVideos,
        };
        return NextResponse.json(response);
    } catch (error) {
        return NextResponse.json(
            { message: `Error fetching objects from R2.`, error: error},
            { status: 500 },
        );
    }
}