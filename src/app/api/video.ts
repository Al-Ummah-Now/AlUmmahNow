import type { NextApiRequest, NextApiResponse } from 'next';
import R2Repository from './r2Repo';
import { VideoObject } from '../interfaces';

const bucketName = 'videos'; // Replace with your bucket name
const repository = new R2Repository<VideoObject>(bucketName);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    switch (req.method) {
        case 'GET':
            try {
                console.log('param', req.query.id);
                if (req.query.id) {
                    // Fetch a single video by ID
                    const id = req.query.id as string;
                    const video = await repository.getObject(id);

                    if (!video) {
                        res.status(404).json({ message: `Video with id ${id} not found` });
                        return;
                    }

                    res.status(200).json(video);
                } else {
                    // List all videos with pagination
                    const page = parseInt(req.query.page as string, 10) || 1; // Default to page 1
                    const limit = parseInt(req.query.limit as string, 10) || 10; // Default to 10 items per page
                    const allVideos = await repository.listObjects();

                    // Calculate pagination
                    const startIndex = (page - 1) * limit;
                    const endIndex = startIndex + limit;
                    const paginatedVideos = allVideos.slice(startIndex, endIndex);

                    res.status(200).json({
                        page,
                        limit,
                        total: allVideos.length,
                        totalPages: Math.ceil(allVideos.length / limit),
                        data: paginatedVideos,
                    });
                }
            } catch (error) {
                console.error('Error fetching objects from R2:', error);
                res.status(500).json({ message: 'Error fetching objects from R2', error });
            }
            break;

        case 'PUT':
            try {
                const { id, ...updatedData } = req.body;

                if (!id) {
                    res.status(400).json({ message: 'Video ID is required for update.' });
                    return;
                }

                const updatedVideo: VideoObject = {
                    ...updatedData,
                    id,
                    dateModified: new Date(),
                };

                await repository.putObject(id, updatedVideo);
                res.status(200).json({ message: `Video with id ${id} updated successfully.` });
            } catch (error) {
                console.error('Error updating video:', error);
                res.status(500).json({ message: 'Error updating video', error });
            }
            break;

        case 'DELETE':
            try {
                const { id } = req.query;

                if (!id) {
                    res.status(400).json({ message: 'Video ID is required for deletion.' });
                    return;
                }

                await repository.deleteObject(id as string);
                res.status(200).json({ message: `Video with id ${id} deleted successfully.` });
            } catch (error) {
                console.error('Error deleting video:', error);
                res.status(500).json({ message: 'Error deleting video', error });
            }
            break;

        default:
            res.setHeader('Allow', ['GET', 'PUT', 'DELETE']);
            res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}