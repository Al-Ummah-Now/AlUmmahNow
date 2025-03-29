import { ResponseError, VideoInfo, VideoObject } from "@/app/interfaces";
import { NextResponse } from "next/server";
import R2Repository from "../../r2Repo";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse<VideoObject | ResponseError>> {
    const { id } = await params;
    const bucketName = 'videos'; // Replace with your bucket name
    const repository = new R2Repository<VideoObject>(bucketName);

    const video = await repository.getObject(id);

    if (!video) {
        return NextResponse.json(
            { message: `Video with id: ${id} not found.` },
            { status: 404 },
        );
    }

    return NextResponse.json(video);
}