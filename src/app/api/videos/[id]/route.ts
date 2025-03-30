import { ResponseError, VideoInfo, VideoObject } from "@/interfaces";
import { NextResponse } from "next/server";
import R2Repository from "../../r2Repo";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse<VideoObject | ResponseError>> {
    const { id } = await params;
    const bucketName = 'videos'; // Replace with your bucket name
    const repository = new R2Repository<VideoObject>(bucketName);

    try {
        const video = await repository.getObject(id);
    
        if (!video) {
            return NextResponse.json(
                { message: `Video with id: ${id} not found.` },
                { status: 404 },
            );
        }

        return NextResponse.json(video);
    } catch (error) {
        console.error(error);
        console.log((error as Error).stack);
        return NextResponse.json(
            { message: `Error fetching objects from R2.`, error: error},
            { status: 500 },
        );
    }
}